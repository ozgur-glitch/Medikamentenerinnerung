import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  Alert,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
  Switch
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Safe Imports mit Fallbacks für Expo Go / Native Module
let Notifications = null;
let DocumentPicker = null;
let FileSystem = null;
let Sharing = null;

try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (e) {
  console.log('expo-notifications nicht verfuegbar:', e.message);
}

try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.log('expo-document-picker nicht verfuegbar:', e.message);
}

try {
  FileSystem = require('expo-file-system');
} catch (e) {
  console.log('expo-file-system nicht verfuegbar:', e.message);
}

try {
  Sharing = require('expo-sharing');
} catch (e) {
  console.log('expo-sharing nicht verfuegbar:', e.message);
}

const STORAGE_KEY_MEDS = '@meds_data_v1';
const STORAGE_KEY_LOGS = '@meds_logs_v1';

export default function App() {
  const [meds, setMeds] = useState([]);
  const [logs, setLogs] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [rawJsonText, setRawJsonText] = useState('');
  
  // Form State
  const [title, setTitle] = useState('');
  const [dosage, setDosage] = useState('');
  const [time, setTime] = useState('08:00');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadData();
    requestPermissions();
  }, []);

  const requestPermissions = async () => {
    if (Notifications && Notifications.requestPermissionsAsync) {
      try {
        await Notifications.requestPermissionsAsync();
      } catch (e) {
        console.log('Notification permission error:', e);
      }
    }
  };

  const loadData = async () => {
    try {
      const storedMeds = await AsyncStorage.getItem(STORAGE_KEY_MEDS);
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY_LOGS);
      if (storedMeds) setMeds(JSON.parse(storedMeds));
      if (storedLogs) setLogs(JSON.parse(storedLogs));
    } catch (e) {
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    }
  };

  const saveData = async (newMeds, newLogs) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_MEDS, JSON.stringify(newMeds));
      await AsyncStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(newLogs));
    } catch (e) {
      Alert.alert('Fehler', 'Speichern fehlgeschlagen.');
    }
  };

  const scheduleNotification = async (med) => {
    if (!Notifications || !Notifications.scheduleNotificationAsync) return null;
    try {
      const [hours, minutes] = med.time.split(':').map(Number);
      const notifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚡ MED-ALERT: ${med.title}`,
          body: `Dosis: ${med.dosage} ${med.notes ? '| ' + med.notes : ''}`,
          sound: true,
        },
        trigger: {
          hour: hours || 8,
          minute: minutes || 0,
          repeats: true,
        },
      });
      return notifId;
    } catch (e) {
      console.log('Notification Scheduling Error:', e);
      return null;
    }
  };

  const cancelNotification = async (notifId) => {
    if (!Notifications || !Notifications.cancelScheduledNotificationAsync || !notifId) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notifId);
    } catch (e) {
      console.log('Cancel Notification Error:', e);
    }
  };

  const addMedication = async () => {
    if (!title.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Namen für das Medikament ein.');
      return;
    }

    const newMed = {
      id: Date.now().toString(),
      title: title.trim(),
      dosage: dosage.trim() || '1 Dosis',
      time: time.trim() || '08:00',
      notes: notes.trim(),
      active: true,
      notificationId: null
    };

    const notifId = await scheduleNotification(newMed);
    newMed.notificationId = notifId;

    const updatedMeds = [...meds, newMed];
    setMeds(updatedMeds);
    saveData(updatedMeds, logs);

    setTitle('');
    setDosage('');
    setTime('08:00');
    setNotes('');
    setModalVisible(false);
  };

  const toggleMedication = async (id) => {
    const updatedMeds = await Promise.all(
      meds.map(async (med) => {
        if (med.id === id) {
          const nextState = !med.active;
          let notifId = med.notificationId;
          if (nextState) {
            notifId = await scheduleNotification(med);
          } else {
            await cancelNotification(med.notificationId);
            notifId = null;
          }
          return { ...med, active: nextState, notificationId: notifId };
        }
        return med;
      })
    );
    setMeds(updatedMeds);
    saveData(updatedMeds, logs);
  };

  const deleteMedication = (id) => {
    Alert.alert(
      'BESTÄTIGUNG',
      'Möchtest du dieses Medikament wirklich löschen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            const target = meds.find((m) => m.id === id);
            if (target && target.notificationId) {
              await cancelNotification(target.notificationId);
            }
            const updatedMeds = meds.filter((m) => m.id !== id);
            setMeds(updatedMeds);
            saveData(updatedMeds, logs);
          },
        },
      ]
    );
  };

  const markAsTaken = (med) => {
    const newLog = {
      id: Date.now().toString(),
      medId: med.id,
      title: med.title,
      dosage: med.dosage,
      timestamp: new Date().toISOString(),
    };
    const updatedLogs = [newLog, ...logs];
    setLogs(updatedLogs);
    saveData(meds, updatedLogs);
    Alert.alert('PROTOKOLLIERT', `${med.title} wurde als eingenommen markiert.`);
  };

  // BACKUP & RESTORE LOGIC
  const exportBackup = async () => {
    const backupData = {
      version: 1,
      exportDate: new Date().toISOString(),
      meds: meds,
      logs: logs,
    };
    const jsonStr = JSON.stringify(backupData, null, 2);

    // Fallback Text Modal vorbereiten
    setRawJsonText(jsonStr);

    try {
      // 1. SAF Android / FileSystem Check
      if (Platform.OS === 'android' && FileSystem && FileSystem.StorageAccessFramework) {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const fileName = `MED_BACKUP_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          const uri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/json'
          );
          await FileSystem.writeAsStringAsync(uri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
          Alert.alert('SUCCESS', 'Backup erfolgreich gespeichert.');
          return;
        }
      }

      // 2. Fallback iOS / General Expo FileSystem + Sharing
      if (FileSystem && FileSystem.documentDirectory && Sharing) {
        const filePath = `${FileSystem.documentDirectory}med_backup.json`;
        await FileSystem.writeAsStringAsync(filePath, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath);
          return;
        }
      }

      // 3. Fallback: Manual Text Modal
      setBackupModalVisible(true);
    } catch (e) {
      console.log('Export Error:', e);
      setBackupModalVisible(true);
    }
  };

  const importBackupFile = async () => {
    try {
      if (!DocumentPicker) {
        setBackupModalVisible(true);
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || !result.assets[0]) return;

      const fileUri = result.assets[0].uri;
      if (FileSystem && FileSystem.readAsStringAsync) {
        const content = await FileSystem.readAsStringAsync(fileUri);
        processImportData(content);
      } else {
        setBackupModalVisible(true);
      }
    } catch (e) {
      Alert.alert('FEHLER', 'Datei konnte nicht gelesen werden. Nutze den Text-Import.');
      setBackupModalVisible(true);
    }
  };

  const processImportData = (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !Array.isArray(parsed.meds)) {
        throw new Error('Ungültiges Datenformat');
      }

      Alert.alert(
        'WARNUNG: DATEN ÜBERSCHREIBEN',
        'Möchtest du alle aktuellen Einträge durch dieses Backup ersetzen?',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Überschreiben',
            style: 'destructive',
            onPress: () => {
              const importedMeds = parsed.meds || [];
              const importedLogs = parsed.logs || [];
              setMeds(importedMeds);
              setLogs(importedLogs);
              saveData(importedMeds, importedLogs);
              setBackupModalVisible(false);
              setRawJsonText('');
              Alert.alert('ERFOLG', 'Daten wurden erfolgreich wiederhergestellt!');
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('FEHLER', 'Ungültige JSON-Struktur. Wiederherstellung abgebrochen.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050B14" />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerSubtitle}>// CORE SYSTEM</text>
        <Text style={styles.headerTitle}>MEDS // PROTOCOL</Text>
        <View style={styles.neonBar} />
      </View>

      {/* ACTION BUTTONS */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.cyanBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.btnText}>+ NEUER EINTRAG</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.outlineBtn} onPress={exportBackup}>
          <Text style={styles.outlineBtnText}>BACKUP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.outlineBtn} onPress={importBackupFile}>
          <Text style={styles.outlineBtnText}>RESTORE</Text>
        </TouchableOpacity>
      </View>

      {/* MEDICATION LIST */}
      <FlatList
        data={meds}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>[ KEINE MEDIKAMENTE REGISTRIERT ]</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, !item.active && styles.cardInactive]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTime}>⏰ {item.time}</Text>
                <Text style={styles.cardTitle}>{item.title.toUpperCase()}</Text>
              </View>
              <Switch
                trackColor={{ false: '#1E293B', true: '#00F0FF' }}
                thumbColor={item.active ? '#050B14' : '#64748B'}
                onValueChange={() => toggleMedication(item.id)}
                value={item.active}
              />
            </View>

            <Text style={styles.cardSub}>DOSIERUNG: {item.dosage}</Text>
            {item.notes ? <Text style={styles.cardNotes}>// {item.notes}</Text> : null}

            <View style={styles.cardFooter}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.greenBtn]}
                onPress={() => markAsTaken(item)}
              >
                <Text style={styles.smallBtnText}>✓ EINNEHMEN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, styles.redBtn]}
                onPress={() => deleteMedication(item.id)}
              >
                <Text style={styles.smallBtnText}>✕ LÖSCHEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* MODAL: NEUES MEDIKAMENT */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// NEUES MEDIKAMENT</Text>
            <View style={styles.neonBar} />

            <Text style={styles.inputLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="z.B. Ibuprofen"
              placeholderTextColor="#64748B"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.inputLabel}>DOSIERUNG</Text>
            <TextInput
              style={styles.input}
              placeholder="z.B. 400mg / 1 Tablette"
              placeholderTextColor="#64748B"
              value={dosage}
              onChangeText={setDosage}
            />

            <Text style={styles.inputLabel}>UHRZEIT (HH:MM)</Text>
            <TextInput
              style={styles.input}
              placeholder="08:00"
              placeholderTextColor="#64748B"
              value={time}
              onChangeText={setTime}
            />

            <Text style={styles.inputLabel}>HINWEIS / NOTIZ</Text>
            <TextInput
              style={styles.input}
              placeholder="z.B. Nach dem Essen"
              placeholderTextColor="#64748B"
              value={notes}
              onChangeText={setNotes}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cyanBtn} onPress={addMedication}>
                <Text style={styles.btnText}>SPEICHERN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.outlineBtnText}>ABBRECHEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: MANUAL BACKUP / RESTORE TEXT */}
      <Modal visible={backupModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// BACKUP DATA CONSOLE</Text>
            <Text style={styles.modalSub}>
              Kopiere den JSON-Code zum Sichern oder füge ein Backup hier ein.
            </Text>

            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              numberOfLines={8}
              value={rawJsonText}
              onChangeText={setRawJsonText}
              placeholder="Paste JSON here..."
              placeholderTextColor="#64748B"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cyanBtn}
                onPress={() => processImportData(rawJsonText)}
              >
                <Text style={styles.btnText}>IMPORT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setBackupModalVisible(false)}
              >
                <Text style={styles.outlineBtnText}>SCHLIESSEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050B14',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  headerSubtitle: {
    color: '#00F0FF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 4,
  },
  neonBar: {
    height: 2,
    backgroundColor: '#00F0FF',
    marginTop: 8,
    shadowColor: '#00F0FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginVertical: 15,
    gap: 8,
  },
  cyanBtn: {
    flex: 2,
    backgroundColor: '#00F0FF',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#050B14',
    fontWeight: '900',
    letterSpacing: 1.5,
    fontSize: 13,
  },
  outlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
  },
  outlineBtnText: {
    color: '#38BDF8',
    fontWeight: '800',
    letterSpacing: 1,
    fontSize: 11,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 30,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: '#0B1528',
  },
  emptyText: {
    color: '#64748B',
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#0B1528',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
  },
  cardInactive: {
    opacity: 0.5,
    borderColor: '#0F172A',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTime: {
    color: '#10B981',
    fontWeight: '800',
    letterSpacing: 1,
    fontSize: 14,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  cardSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 8,
  },
  cardNotes: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
  },
  greenBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  redBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  smallBtnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 11, 20, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#0B1528',
    borderWidth: 1,
    borderColor: '#00F0FF',
    borderRadius: 8,
    padding: 20,
  },
  modalTitle: {
    color: '#00F0FF',
    fontWeight: '900',
    letterSpacing: 2,
    fontSize: 16,
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#050B14',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 4,
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  modalBtnRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10,
  },
});
