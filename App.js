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
  Platform,
  Switch,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Sichere Imports mit Fallbacks für Expo Go / Native Module
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
  console.log('expo-notifications nicht verfügbar:', e.message);
}

try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.log('expo-document-picker nicht verfügbar:', e.message);
}

try {
  FileSystem = require('expo-file-system');
} catch (e) {
  console.log('expo-file-system nicht verfügbar:', e.message);
}

try {
  Sharing = require('expo-sharing');
} catch (e) {
  console.log('expo-sharing nicht verfügbar:', e.message);
}

const STORAGE_KEY_MEDS = '@meds_data_v1';
const STORAGE_KEY_LOGS = '@meds_logs_v1';
const STORAGE_KEY_BP = '@bp_logs_v1';
const STORAGE_KEY_THEME = '@meds_theme_v1';

export default function App() {
  const [meds, setMeds] = useState([]);
  const [logs, setLogs] = useState([]);
  const [bpLogs, setBpLogs] = useState([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState('MEDS'); // 'MEDS', 'STATS', 'BP'

  // Zeitraum-Filter für Blutdruck-Statistik ('ALL', '30', '7')
  const [bpTimeframe, setBpTimeframe] = useState('ALL');

  // Modals
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMedId, setEditingMedId] = useState(null);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [snoozeModalVisible, setSnoozeModalVisible] = useState(false);
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [selectedMedForSnooze, setSelectedMedForSnooze] = useState(null);
  const [customSnoozeMinutes, setCustomSnoozeMinutes] = useState('');
  const [rawJsonText, setRawJsonText] = useState('');

  // Historie-Bearbeitungs-State
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [editingLogId, setEditingLogId] = useState(null);
  const [logTitle, setLogTitle] = useState('');
  const [logTime, setLogTime] = useState('');
  const [logStatus, setLogStatus] = useState('EINGENOMMEN');

  // Formular-Zustand für Medikamente
  const [title, setTitle] = useState('');
  const [dosage, setDosage] = useState('');
  const [time, setTime] = useState('08:00');
  const [notes, setNotes] = useState('');

  // Formular-Zustand für Blutdruck
  const [bpModalVisible, setBpModalVisible] = useState(false);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [bpNotes, setBpNotes] = useState('');

  const lastNotificationResponse = Notifications?.useLastNotificationResponse
    ? Notifications.useLastNotificationResponse()
    : null;

  useEffect(() => {
    loadData();
    setupNotificationActions();
  }, []);

  useEffect(() => {
    if (lastNotificationResponse) {
      handleNotificationAction(lastNotificationResponse);
    }
  }, [lastNotificationResponse]);

  const handleTimeChange = (text) => {
    let cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length > 4) cleaned = cleaned.slice(0, 4);

    if (cleaned.length >= 3) {
      setTime(`${cleaned.slice(0, 2)}:${cleaned.slice(2)}`);
    } else {
      setTime(cleaned);
    }
  };

  const setupNotificationActions = async () => {
    if (!Notifications) return;
    try {
      await Notifications.setNotificationCategoryAsync('med_actions', [
        {
          identifier: 'ACTION_TAKEN',
          buttonTitle: '✅ Nehmen',
          options: { opensAppToForeground: false },
        },
        {
          identifier: 'ACTION_SNOOZE_30',
          buttonTitle: '⏱️ Später (+30 Min)',
          options: { opensAppToForeground: false },
        },
        {
          identifier: 'ACTION_SKIP',
          buttonTitle: '⏭️ Überspringen',
          options: { opensAppToForeground: false },
        },
      ]);

      Notifications.addNotificationResponseReceivedListener((response) => {
        handleNotificationAction(response);
      });

      await Notifications.requestPermissionsAsync();
    } catch (e) {
      console.log('Fehler beim Setup der Benachrichtigungen:', e);
    }
  };

  const handleNotificationAction = async (response) => {
    const actionId = response.actionIdentifier;
    if (!actionId || actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const notification = response.notification;
    const notificationData = notification?.request?.content?.data;
    const medId = notificationData?.medId;

    if (Notifications) {
      try {
        if (notification?.request?.identifier) {
          await Notifications.dismissNotificationAsync(notification.request.identifier);
        }
        await Notifications.dismissAllNotificationsAsync();
      } catch (e) {
        console.log('Fehler beim Schließen der Benachrichtigung:', e);
      }
    }

    if (!medId) return;

    try {
      const storedMeds = await AsyncStorage.getItem(STORAGE_KEY_MEDS);
      const currentMeds = storedMeds ? JSON.parse(storedMeds) : [];
      const targetMed = currentMeds.find((m) => m.id === medId);

      if (!targetMed) return;

      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY_LOGS);
      const currentLogs = storedLogs ? JSON.parse(storedLogs) : [];

      if (actionId === 'ACTION_TAKEN') {
        const newLog = {
          id: Date.now().toString(),
          medId: targetMed.id,
          title: targetMed.title,
          dosage: targetMed.dosage,
          scheduledTime: targetMed.time,
          status: 'EINGENOMMEN',
          timestamp: new Date().toISOString(),
        };
        const updatedLogs = [newLog, ...currentLogs];
        await AsyncStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(updatedLogs));
        setLogs(updatedLogs);
      } else if (actionId === 'ACTION_SNOOZE_30') {
        await executeSnooze(targetMed, 30);
      } else if (actionId === 'ACTION_SKIP') {
        const newLog = {
          id: Date.now().toString(),
          medId: targetMed.id,
          title: targetMed.title,
          dosage: targetMed.dosage,
          scheduledTime: targetMed.time,
          status: 'ÜBERSPRUNGEN',
          timestamp: new Date().toISOString(),
        };
        const updatedLogs = [newLog, ...currentLogs];
        await AsyncStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(updatedLogs));
        setLogs(updatedLogs);
      }
    } catch (e) {
      console.log('Fehler bei Verarbeitung der Push-Aktion:', e);
    }
  };

  const executeSnooze = async (med, minutes) => {
    if (!Notifications || !Notifications.scheduleNotificationAsync) return;
    try {
      await Notifications.dismissAllNotificationsAsync();

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ VERZÖGERTER ALARM: ${med.title}`,
          body: `Erinnerung um ${minutes} Minuten verzögert. Dosis: ${med.dosage}`,
          sound: true,
          categoryIdentifier: 'med_actions',
          data: { medId: med.id, medTitle: med.title },
        },
        trigger: { seconds: minutes * 60 },
      });
      Alert.alert('⏳ SCHLUMMERN AKTIV', `Erinnerung für ${med.title} um ${minutes} Minuten verschoben.`);
    } catch (e) {
      console.log('Fehler beim Schlummern:', e);
    }
  };

  const handleCustomSnoozeSubmit = () => {
    const mins = parseInt(customSnoozeMinutes, 10);
    if (isNaN(mins) || mins <= 0) {
      Alert.alert('⚠️ FEHLER', 'Bitte gib eine gültige Minutenanzahl ein.');
      return;
    }
    if (selectedMedForSnooze) {
      executeSnooze(selectedMedForSnooze, mins);
    }
    setCustomSnoozeMinutes('');
    setSnoozeModalVisible(false);
    setSelectedMedForSnooze(null);
  };

  const loadData = async () => {
    try {
      const storedMeds = await AsyncStorage.getItem(STORAGE_KEY_MEDS);
      const storedLogs = await AsyncStorage.getItem(STORAGE_KEY_LOGS);
      const storedBpLogs = await AsyncStorage.getItem(STORAGE_KEY_BP);
      const storedTheme = await AsyncStorage.getItem(STORAGE_KEY_THEME);

      if (storedMeds) setMeds(JSON.parse(storedMeds));
      if (storedLogs) setLogs(JSON.parse(storedLogs));
      if (storedBpLogs) setBpLogs(JSON.parse(storedBpLogs));
      if (storedTheme !== null) setIsDarkMode(JSON.parse(storedTheme));
    } catch (e) {
      Alert.alert('⚠️ Fehler', 'Daten konnten nicht geladen werden.');
    }
  };

  const saveData = async (newMeds, newLogs, newBpLogs = bpLogs) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_MEDS, JSON.stringify(newMeds));
      await AsyncStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(newLogs));
      await AsyncStorage.setItem(STORAGE_KEY_BP, JSON.stringify(newBpLogs));
    } catch (e) {
      Alert.alert('⚠️ Fehler', 'Speichern fehlgeschlagen.');
    }
  };

  const toggleTheme = async (value) => {
    setIsDarkMode(value);
    try {
      await AsyncStorage.setItem(STORAGE_KEY_THEME, JSON.stringify(value));
    } catch (e) {
      console.log('Fehler beim Speichern des Themes:', e);
    }
  };

  const scheduleNotification = async (med) => {
    if (!Notifications || !Notifications.scheduleNotificationAsync) return null;
    try {
      const [hours, minutes] = med.time.split(':').map(Number);
      const notifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚡ MEDIKAMENTEN-ALARM: ${med.title}`,
          body: `Dosis: ${med.dosage} ${med.notes ? '| ' + med.notes : ''}`,
          sound: true,
          categoryIdentifier: 'med_actions',
          data: { medId: med.id, medTitle: med.title },
        },
        trigger: {
          hour: hours || 8,
          minute: minutes || 0,
          repeats: true,
        },
      });
      return notifId;
    } catch (e) {
      console.log('Fehler beim Planen der Benachrichtigung:', e);
      return null;
    }
  };

  const cancelNotification = async (notifId) => {
    if (!Notifications || !Notifications.cancelScheduledNotificationAsync || !notifId) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notifId);
    } catch (e) {
      console.log('Fehler beim Löschen der Benachrichtigung:', e);
    }
  };

  const saveMedicationForm = async () => {
    if (!title.trim()) {
      Alert.alert('⚠️ Fehler', 'Bitte gib einen Namen für das Medikament ein.');
      return;
    }

    let formattedTime = time.trim();
    if (!formattedTime.includes(':') && formattedTime.length === 4) {
      formattedTime = `${formattedTime.slice(0, 2)}:${formattedTime.slice(2)}`;
    }

    if (editingMedId) {
      const target = meds.find((m) => m.id === editingMedId);
      if (target && target.notificationId) {
        await cancelNotification(target.notificationId);
      }

      const updatedMed = {
        id: editingMedId,
        title: title.trim(),
        dosage: dosage.trim() || '1 Dosis',
        time: formattedTime || '08:00',
        notes: notes.trim(),
        active: target ? target.active : true,
        notificationId: null
      };

      if (updatedMed.active) {
        updatedMed.notificationId = await scheduleNotification(updatedMed);
      }

      const updatedMeds = meds.map((m) => (m.id === editingMedId ? updatedMed : m));
      setMeds(updatedMeds);
      saveData(updatedMeds, logs);
    } else {
      const newMed = {
        id: Date.now().toString(),
        title: title.trim(),
        dosage: dosage.trim() || '1 Dosis',
        time: formattedTime || '08:00',
        notes: notes.trim(),
        active: true,
        notificationId: null
      };

      const notifId = await scheduleNotification(newMed);
      newMed.notificationId = notifId;

      const updatedMeds = [...meds, newMed];
      setMeds(updatedMeds);
      saveData(updatedMeds, logs);
    }

    setTitle('');
    setDosage('');
    setTime('08:00');
    setNotes('');
    setEditingMedId(null);
    setModalVisible(false);
  };

  const openEditModal = (med) => {
    setEditingMedId(med.id);
    setTitle(med.title);
    setDosage(med.dosage);
    setTime(med.time);
    setNotes(med.notes || '');
    setModalVisible(true);
  };

  const openNewModal = () => {
    setEditingMedId(null);
    setTitle('');
    setDosage('');
    setTime('08:00');
    setNotes('');
    setModalVisible(true);
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
      '🗑️ BESTÄTIGUNG',
      'Möchtest du dieses Medikament wirklich löschen?',
      [
        { text: '❌ Abbrechen', style: 'cancel' },
        {
          text: '🗑️ Löschen',
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

  const markAsTaken = async (med) => {
    if (Notifications) {
      try {
        await Notifications.dismissAllNotificationsAsync();
      } catch (e) {}
    }
    const newLog = {
      id: Date.now().toString(),
      medId: med.id,
      title: med.title,
      dosage: med.dosage,
      scheduledTime: med.time,
      status: 'EINGENOMMEN',
      timestamp: new Date().toISOString(),
    };
    const updatedLogs = [newLog, ...logs];
    setLogs(updatedLogs);
    saveData(meds, updatedLogs);
    Alert.alert('✅ PROTOKOLLIERT', `${med.title} wurde als eingenommen markiert.`);
  };

  const skipMedication = (med) => {
    Alert.alert(
      '⏭️ DOSIS ÜBERSPRINGEN',
      `Möchtest du die Dosis für ${med.title} überspringen?`,
      [
        { text: '❌ Abbrechen', style: 'cancel' },
        {
          text: '⏭️ Überspringen',
          onPress: async () => {
            if (Notifications) {
              try {
                await Notifications.dismissAllNotificationsAsync();
              } catch (e) {}
            }
            const newLog = {
              id: Date.now().toString(),
              medId: med.id,
              title: med.title,
              dosage: med.dosage,
              scheduledTime: med.time,
              status: 'ÜBERSPRUNGEN',
              timestamp: new Date().toISOString(),
            };
            const updatedLogs = [newLog, ...logs];
            setLogs(updatedLogs);
            saveData(meds, updatedLogs);
            Alert.alert('⏭️ ÜBERSPRUNGEN', `Die Dosis für ${med.title} wurde übersprungen.`);
          },
        },
      ]
    );
  };

  const openEditLogModal = (log) => {
    setEditingLogId(log.id);
    setLogTitle(log.title);
    setLogTime(log.scheduledTime || '08:00');
    setLogStatus(log.status);
    setLogModalVisible(true);
  };

  const saveLogForm = () => {
    if (!logTitle.trim()) {
      Alert.alert('⚠️ FEHLER', 'Bitte gib einen gültigen Namen ein.');
      return;
    }

    const updatedLogs = logs.map((log) => {
      if (log.id === editingLogId) {
        return {
          ...log,
          title: logTitle.trim(),
          scheduledTime: logTime.trim(),
          status: logStatus,
        };
      }
      return log;
    });

    setLogs(updatedLogs);
    saveData(meds, updatedLogs);
    setLogModalVisible(false);
    setEditingLogId(null);
  };

  const deleteLogItem = (id) => {
    Alert.alert(
      '🗑️ HISTORIE LÖSCHEN',
      'Möchtest du diesen Eintrag aus dem Verlauf wirklich löschen?',
      [
        { text: '❌ Abbrechen', style: 'cancel' },
        {
          text: '🗑️ Löschen',
          style: 'destructive',
          onPress: () => {
            const updatedLogs = logs.filter((l) => l.id !== id);
            setLogs(updatedLogs);
            saveData(meds, updatedLogs);
          },
        },
      ]
    );
  };

  // LOGIK FÜR BLUTDRUCK
  const saveBpEntry = () => {
    const sys = parseInt(systolic, 10);
    const dia = parseInt(diastolic, 10);
    const p = pulse ? parseInt(pulse, 10) : null;

    if (isNaN(sys) || isNaN(dia) || sys <= 0 || dia <= 0) {
      Alert.alert('⚠️ FEHLER', 'Bitte gib gültige Werte für Systole und Diastole ein.');
      return;
    }

    let status = 'NORMAL';
    if (sys >= 140 || dia >= 90) {
      status = 'HYPERTONIE';
    } else if (sys >= 120 || dia >= 80) {
      status = 'HOCH-NORMAL';
    }

    const newBpLog = {
      id: Date.now().toString(),
      systolic: sys,
      diastolic: dia,
      pulse: p,
      status,
      notes: bpNotes.trim(),
      timestamp: new Date().toISOString(),
    };

    const updatedBpLogs = [newBpLog, ...bpLogs];
    setBpLogs(updatedBpLogs);
    saveData(meds, logs, updatedBpLogs);

    setSystolic('');
    setDiastolic('');
    setPulse('');
    setBpNotes('');
    setBpModalVisible(false);
  };

  const deleteBpLog = (id) => {
    Alert.alert(
      '🗑️ LÖSCHEN',
      'Möchtest du diesen Blutdruckeintrag löschen?',
      [
        { text: '❌ Abbrechen', style: 'cancel' },
        {
          text: '🗑️ Löschen',
          style: 'destructive',
          onPress: () => {
            const updated = bpLogs.filter((b) => b.id !== id);
            setBpLogs(updated);
            saveData(meds, logs, updated);
          },
        },
      ]
    );
  };

  const exportBackup = async () => {
    const backupData = {
      version: 2,
      exportDate: new Date().toISOString(),
      meds: meds,
      logs: logs,
      bpLogs: bpLogs,
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    setRawJsonText(jsonStr);

    try {
      if (Platform.OS === 'android' && FileSystem && FileSystem.StorageAccessFramework) {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const fileName = `medikamentenerinnerung_sicherung_${new Date().toISOString().slice(0, 10)}.json`;
          const uri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/json'
          );
          await FileSystem.writeAsStringAsync(uri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
          Alert.alert('💾 ERFOLG', 'Sicherungsdatei (.json) wurde erfolgreich gespeichert.');
          return;
        }
      }

      if (FileSystem && FileSystem.documentDirectory && Sharing) {
        const filePath = `${FileSystem.documentDirectory}medikamentenerinnerung_sicherung.json`;
        await FileSystem.writeAsStringAsync(filePath, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath, { mimeType: 'application/json', dialogTitle: 'Sicherungsdatei speichern' });
          return;
        }
      }

      setBackupModalVisible(true);
    } catch (e) {
      console.log('Export-Fehler:', e);
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
      Alert.alert('⚠️ FEHLER', 'Sicherungsdatei konnte nicht gelesen werden.');
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
        '⚠️ WARNUNG: DATEN ÜBERSCHREIBEN',
        'Möchtest du alle aktuellen Einträge durch diese Sicherungsdatei ersetzen?',
        [
          { text: '❌ Abbrechen', style: 'cancel' },
          {
            text: '🔄 Überschreiben',
            style: 'destructive',
            onPress: () => {
              const importedMeds = parsed.meds || [];
              const importedLogs = parsed.logs || [];
              const importedBpLogs = parsed.bpLogs || [];
              setMeds(importedMeds);
              setLogs(importedLogs);
              setBpLogs(importedBpLogs);
              saveData(importedMeds, importedLogs, importedBpLogs);
              setBackupModalVisible(false);
              setRawJsonText('');
              Alert.alert('✅ ERFOLG', 'Daten wurden erfolgreich wiederhergestellt!');
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('⚠️ FEHLER', 'Ungültige Struktur der Sicherungsdatei.');
    }
  };

  const calculateStatistics = () => {
    const totalLogs = logs.length;
    const takenLogs = logs.filter((l) => l.status === 'EINGENOMMEN');
    const skippedLogs = logs.filter((l) => l.status === 'ÜBERSPRUNGEN');

    const adherenceRate = totalLogs > 0 ? Math.round((takenLogs.length / totalLogs) * 100) : 0;

    let totalDelayMinutes = 0;
    let validDelayCount = 0;

    takenLogs.forEach((log) => {
      if (log.scheduledTime && log.timestamp) {
        const takenDate = new Date(log.timestamp);
        const [targetHours, targetMinutes] = log.scheduledTime.split(':').map(Number);

        const scheduledDate = new Date(takenDate);
        scheduledDate.setHours(targetHours || 0, targetMinutes || 0, 0, 0);

        const diffMs = takenDate.getTime() - scheduledDate.getTime();
        const diffMinutes = Math.round(diffMs / (1000 * 60));

        if (diffMinutes > 0) {
          totalDelayMinutes += diffMinutes;
        }
        validDelayCount++;
      }
    });

    const averageDelay = validDelayCount > 0 ? Math.round(totalDelayMinutes / validDelayCount) : 0;

    return {
      totalLogs,
      takenCount: takenLogs.length,
      skippedCount: skippedLogs.length,
      adherenceRate,
      averageDelay,
    };
  };

  // ERWEITERTE BLUTDRUCK-STATISTIK BERECHNEN
  const calculateBpStatistics = () => {
    const now = new Date();
    const filteredBpLogs = bpLogs.filter((item) => {
      if (bpTimeframe === 'ALL') return true;
      const logDate = new Date(item.timestamp);
      const diffDays = (now - logDate) / (1000 * 60 * 60 * 24);
      if (bpTimeframe === '7') return diffDays <= 7;
      if (bpTimeframe === '30') return diffDays <= 30;
      return true;
    });

    const total = filteredBpLogs.length;
    if (total === 0) {
      return {
        total: 0,
        hypertoniaPct: 0,
        highNormalPct: 0,
        normalPct: 0,
        avgSys: 0,
        avgDia: 0,
        avgPulse: 0,
      };
    }

    const hyperCount = filteredBpLogs.filter((b) => b.status === 'HYPERTONIE').length;
    const highNormalCount = filteredBpLogs.filter((b) => b.status === 'HOCH-NORMAL').length;
    const normalCount = filteredBpLogs.filter((b) => b.status === 'NORMAL').length;

    const hypertoniaPct = Math.round((hyperCount / total) * 100);
    const highNormalPct = Math.round((highNormalCount / total) * 100);
    const normalPct = Math.round((normalCount / total) * 100);

    const sumSys = filteredBpLogs.reduce((acc, curr) => acc + curr.systolic, 0);
    const sumDia = filteredBpLogs.reduce((acc, curr) => acc + curr.diastolic, 0);

    const pulseLogs = filteredBpLogs.filter((b) => b.pulse && b.pulse > 0);
    const sumPulse = pulseLogs.reduce((acc, curr) => acc + curr.pulse, 0);

    return {
      total,
      hypertoniaPct,
      highNormalPct,
      normalPct,
      avgSys: Math.round(sumSys / total),
      avgDia: Math.round(sumDia / total),
      avgPulse: pulseLogs.length > 0 ? Math.round(sumPulse / pulseLogs.length) : 0,
    };
  };

  const stats = calculateStatistics();
  const bpStats = calculateBpStatistics();
  const theme = isDarkMode ? darkColors : lightColors;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.headerTitle, { color: theme.textMain }]} adjustsFontSizeToFit numberOfLines={1}>
            💊 MEDIKAMENTENERINNERUNG
          </Text>

          {/* DUNKELMODUS-SCHALTER */}
          <View style={styles.themeToggleContainer}>
            <Text style={[styles.themeLabel, { color: theme.textSub }]}>
              {isDarkMode ? '🌙 DUNKEL' : '☀️ HELL'}
            </Text>
            <Switch
              trackColor={{ false: '#CBD5E1', true: '#00F0FF' }}
              thumbColor={isDarkMode ? '#00F0FF' : '#0F172A'}
              onValueChange={toggleTheme}
              value={isDarkMode}
            />
          </View>
        </View>
        <View style={[styles.neonBar, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />
      </View>

      {/* KORRIGIERTE DREI-TAB NAVIGATIONSLEISTE */}
      <View style={styles.mainTabRow}>
        <TouchableOpacity
          style={[
            styles.mainTabBtn,
            {
              borderColor: theme.cardBorder,
              backgroundColor: activeTab === 'MEDS' ? theme.accent : theme.tabInactiveBg,
            },
          ]}
          onPress={() => setActiveTab('MEDS')}
          activeOpacity={0.7}
        >
          <View style={styles.tabContentRow}>
            <Text style={styles.tabEmoji}>💊</Text>
            <Text
              style={[
                styles.mainTabText,
                { color: activeTab === 'MEDS' ? '#FFFFFF' : theme.textMain },
              ]}
            >
              MEDS
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mainTabBtn,
            {
              borderColor: theme.cardBorder,
              backgroundColor: activeTab === 'STATS' ? theme.accent : theme.tabInactiveBg,
            },
          ]}
          onPress={() => setActiveTab('STATS')}
          activeOpacity={0.7}
        >
          <View style={styles.tabContentRow}>
            <Text style={styles.tabEmoji}>📊</Text>
            <Text
              style={[
                styles.mainTabText,
                { color: activeTab === 'STATS' ? '#FFFFFF' : theme.textMain },
              ]}
            >
              STATISTIK
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mainTabBtn,
            {
              borderColor: theme.cardBorder,
              backgroundColor: activeTab === 'BP' ? theme.accent : theme.tabInactiveBg,
            },
          ]}
          onPress={() => setActiveTab('BP')}
          activeOpacity={0.7}
        >
          <View style={styles.tabContentRow}>
            <Text style={styles.tabEmoji}>🫀</Text>
            <Text
              style={[
                styles.mainTabText,
                { color: activeTab === 'BP' ? '#FFFFFF' : theme.textMain },
              ]}
            >
              BLUTDRUCK
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* TAB 1: MEDIKAMENTE */}
      {activeTab === 'MEDS' && (
        <View style={{ flex: 1 }}>
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.cyanBtn, { backgroundColor: theme.accent }]} onPress={openNewModal}>
              <Text style={[styles.btnText, { color: theme.btnTextColor }]}>➕ NEU</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={exportBackup}>
              <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>💾 SICHERN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={importBackupFile}>
              <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>📂 LADEN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setGuideModalVisible(true)}>
              <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>📖 HILFE</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={meds}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <View style={[styles.emptyCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <Text style={[styles.emptyText, { color: theme.textSub }]}>[ 📭 KEINE MEDIKAMENTE ERFASST ]</Text>
                <Text style={[styles.emptySubText, { color: theme.textMuted }]}>Tippe oben auf "➕ NEU", um einen Eintrag zu erstellen.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }, !item.active && styles.cardInactive]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.timeBadge}>
                      <Text style={styles.cardTime}>⏰ {item.time} UHR</Text>
                    </View>
                    <Text style={[styles.cardTitle, { color: theme.textMain }]}>💊 {item.title.toUpperCase()}</Text>
                  </View>
                  <Switch
                    trackColor={{ false: '#CBD5E1', true: '#00F0FF' }}
                    thumbColor={item.active ? (isDarkMode ? '#00F0FF' : '#0F172A') : '#64748B'}
                    onValueChange={() => toggleMedication(item.id)}
                    value={item.active}
                  />
                </View>

                <View style={styles.cardBody}>
                  <Text style={[styles.cardSub, { color: theme.textSub }]}>
                    🧪 DOSIERUNG: <Text style={{ color: theme.textMain, fontWeight: '800' }}>{item.dosage}</Text>
                  </Text>
                  {item.notes ? <Text style={[styles.cardNotes, { color: theme.textMuted }]}>📝 HINWEIS: {item.notes}</Text> : null}
                </View>

                <View style={styles.cardFooterContainer}>
                  <View style={styles.cardFooterRow}>
                    <TouchableOpacity style={[styles.smallBtn, styles.greenBtn]} onPress={() => markAsTaken(item)}>
                      <Text style={styles.smallBtnTextGreen}>✅ NEHMEN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, styles.amberBtn]} onPress={() => { setSelectedMedForSnooze(item); setSnoozeModalVisible(true); }}>
                      <Text style={styles.smallBtnTextAmber}>⏱️ SPÄTER</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, styles.purpleBtn]} onPress={() => skipMedication(item)}>
                      <Text style={styles.smallBtnTextPurple}>⏭️ ÜBERSPRINGEN</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardFooterRow}>
                    <TouchableOpacity style={[styles.smallBtn, styles.blueBtn]} onPress={() => openEditModal(item)}>
                      <Text style={styles.smallBtnTextBlue}>✏️ BEARBEITEN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, styles.redBtn]} onPress={() => deleteMedication(item.id)}>
                      <Text style={styles.smallBtnTextRed}>🗑️ LÖSCHEN</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* TAB 2: STATISTIK MEDIKAMENTE */}
      {activeTab === 'STATS' && (
        <ScrollView contentContainerStyle={styles.statsContainer}>
          <Text style={[styles.sectionHeaderTitle, { color: theme.accent }]}>
            📊 AUSWERTUNG & ANALYSE
          </Text>

          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={styles.statIcon}>📈</Text>
              <Text style={[styles.statValue, { color: '#10B981' }]}>{stats.adherenceRate}%</Text>
              <Text style={[styles.statTitle, { color: theme.textMain }]}>EINNAHMEQUOTE</Text>
              <Text style={[styles.statSubText, { color: theme.textMuted }]}>
                {stats.takenCount} von {stats.totalLogs} Dosen eingenommen ({stats.skippedCount} übersprungen).
              </Text>
            </View>

            <View style={[styles.statCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={styles.statIcon}>⏱️</Text>
              <Text style={[styles.statValue, { color: '#F59E0B' }]}>
                {stats.averageDelay} <Text style={{ fontSize: 16 }}>Min.</Text>
              </Text>
              <Text style={[styles.statTitle, { color: theme.textMain }]}>DURCHSCHN. VERSPÄTUNG</Text>
              <Text style={[styles.statSubText, { color: theme.textMuted }]}>Abweichung zur eingestellten Uhrzeit.</Text>
            </View>
          </View>

          <Text style={[styles.sectionHeaderTitle, { color: theme.textMain, marginTop: 24 }]}>
            📋 HISTORIE ({logs.length} EINTRÄGE)
          </Text>

          {logs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={[styles.emptyText, { color: theme.textSub }]}>[ 📭 NOCH KEINE STATISTIK-DATEN ]</Text>
            </View>
          ) : (
            logs.map((log) => (
              <View key={log.id} style={[styles.logItem, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={[styles.logTitle, { color: theme.textMain }]}>💊 {log.title}</Text>
                  <Text style={[styles.logDate, { color: theme.textMuted }]}>
                    {new Date(log.timestamp).toLocaleString('de-DE')} | Soll: {log.scheduledTime || '08:00'} Uhr
                  </Text>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={[styles.statusBadge, log.status === 'EINGENOMMEN' ? styles.badgeTaken : styles.badgeSkipped]}>
                    <Text style={log.status === 'EINGENOMMEN' ? styles.badgeTextTaken : styles.badgeTextSkipped}>{log.status}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={styles.logActionBtn} onPress={() => openEditLogModal(log)}>
                      <Text style={{ fontSize: 12 }}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.logActionBtn} onPress={() => deleteLogItem(log.id)}>
                      <Text style={{ fontSize: 12 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* TAB 3: BLUTDRUCK-TAGEBUCH + STATISTIK */}
      {activeTab === 'BP' && (
        <ScrollView contentContainerStyle={styles.statsContainer}>
          <Text style={[styles.sectionHeaderTitle, { color: theme.accent }]}>
            🫀 BLUTDRUCK-STATISTIK & TAGEBUCH
          </Text>

          {/* ZEITRAUM-FILTER BUTTONS */}
          <View style={styles.timeframeRow}>
            <TouchableOpacity
              style={[
                styles.timeframeBtn,
                { borderColor: theme.cardBorder, backgroundColor: bpTimeframe === 'ALL' ? theme.accent : theme.tabInactiveBg }
              ]}
              onPress={() => setBpTimeframe('ALL')}
            >
              <Text style={[styles.timeframeBtnText, { color: bpTimeframe === 'ALL' ? (isDarkMode ? '#030712' : '#FFFFFF') : theme.textMain }]}>
                GESAMT
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.timeframeBtn,
                { borderColor: theme.cardBorder, backgroundColor: bpTimeframe === '30' ? theme.accent : theme.tabInactiveBg }
              ]}
              onPress={() => setBpTimeframe('30')}
            >
              <Text style={[styles.timeframeBtnText, { color: bpTimeframe === '30' ? (isDarkMode ? '#030712' : '#FFFFFF') : theme.textMain }]}>
                30 TAGE
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.timeframeBtn,
                { borderColor: theme.cardBorder, backgroundColor: bpTimeframe === '7' ? theme.accent : theme.tabInactiveBg }
              ]}
              onPress={() => setBpTimeframe('7')}
            >
              <Text style={[styles.timeframeBtnText, { color: bpTimeframe === '7' ? (isDarkMode ? '#030712' : '#FFFFFF') : theme.textMain }]}>
                7 TAGE
              </Text>
            </TouchableOpacity>
          </View>

          {/* PROZENTUALE PROFIL-AUSWERTUNG */}
          <View style={[styles.bpStatsCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
            <Text style={[styles.bpStatsTitle, { color: theme.textMain }]}>
              📊 ANALYSE ({bpStats.total} MESSUNGEN)
            </Text>

            <View style={styles.bpBarContainer}>
              <View style={[styles.bpBarSegment, { backgroundColor: '#EF4444', flex: bpStats.hypertoniaPct || 1 }]} />
              <View style={[styles.bpBarSegment, { backgroundColor: '#F59E0B', flex: bpStats.highNormalPct || 1 }]} />
              <View style={[styles.bpBarSegment, { backgroundColor: '#10B981', flex: bpStats.normalPct || 1 }]} />
            </View>

            <View style={styles.bpPctGrid}>
              <View style={styles.bpPctItem}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#EF4444' }}>{bpStats.hypertoniaPct}%</Text>
                <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textSub }}>🔴 HYPERTONIE</Text>
              </View>

              <View style={styles.bpPctItem}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#F59E0B' }}>{bpStats.highNormalPct}%</Text>
                <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textSub }}>🟡 HOCH-NORMAL</Text>
              </View>

              <View style={styles.bpPctItem}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#10B981' }}>{bpStats.normalPct}%</Text>
                <Text style={{ fontSize: 9, fontWeight: '800', color: theme.textSub }}>🟢 OPTIMAL</Text>
              </View>
            </View>

            {bpStats.total > 0 && (
              <View style={[styles.bpAvgRow, { borderColor: theme.cardBorder }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textSub }}>
                  Ø Wert: <Text style={{ color: theme.textMain, fontWeight: '900' }}>{bpStats.avgSys}/{bpStats.avgDia} mmHg</Text>
                </Text>
                {bpStats.avgPulse > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textSub }}>
                    ❤️ Ø Puls: <Text style={{ color: theme.textMain, fontWeight: '900' }}>{bpStats.avgPulse} BPM</Text>
                  </Text>
                )}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.cyanBtn, { backgroundColor: theme.accent, marginBottom: 16 }]}
            onPress={() => setBpModalVisible(true)}
          >
            <Text style={[styles.btnText, { color: theme.btnTextColor, fontSize: 12 }]}>➕ MESSUNG EINTRAGEN</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionHeaderTitle, { color: theme.textMain }]}>
            📋 HISTORIE DER MESSUNGEN
          </Text>

          {bpLogs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <Text style={[styles.emptyText, { color: theme.textSub }]}>[ 📭 KEINE BLUTDRUCKMESSUNGEN ]</Text>
              <Text style={[styles.emptySubText, { color: theme.textMuted }]}>Tippe oben auf "➕ MESSUNG EINTRAGEN".</Text>
            </View>
          ) : (
            bpLogs.map((item) => {
              let badgeStyle = styles.badgeGreen;
              let badgeText = styles.badgeTextGreen;
              if (item.status === 'HYPERTONIE') {
                badgeStyle = styles.badgeRed;
                badgeText = styles.badgeTextRed;
              } else if (item.status === 'HOCH-NORMAL') {
                badgeStyle = styles.badgeAmber;
                badgeText = styles.badgeTextAmber;
              }

              return (
                <View key={item.id} style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ fontSize: 20, fontWeight: '900', color: theme.textMain }}>
                        {item.systolic} / {item.diastolic} <Text style={{ fontSize: 12, color: theme.textMuted }}>mmHg</Text>
                      </Text>
                      {item.pulse ? (
                        <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 2 }}>
                          ❤️ Puls: <Text style={{ fontWeight: '800' }}>{item.pulse} BPM</Text>
                        </Text>
                      ) : null}
                    </View>

                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <View style={[styles.statusBadge, badgeStyle]}>
                        <Text style={badgeText}>{item.status}</Text>
                      </View>
                      <TouchableOpacity onPress={() => deleteBpLog(item.id)}>
                        <Text style={{ fontSize: 12, color: '#EF4444', fontWeight: '800' }}>🗑️ Löschen</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <Text style={{ fontSize: 10, color: theme.textMuted, marginTop: 8 }}>
                    📅 {new Date(item.timestamp).toLocaleString('de-DE')}
                  </Text>
                  {item.notes ? (
                    <Text style={{ fontSize: 11, fontStyle: 'italic', color: theme.textSub, marginTop: 4 }}>
                      📝 {item.notes}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* FOOTER */}
      <View style={[styles.developerFooter, { borderColor: theme.cardBorder, backgroundColor: theme.cardBg }]}>
        <Text style={[styles.developerText, { color: theme.textMuted }]}>
          👨‍💻 Entwickler: Özgür Cetin | ✉️ ozgur.cetin@web.de
        </Text>
      </View>

      {/* MODAL: BLUTDRUCK MESSUNG ANLEGEN */}
      <Modal visible={bpModalVisible} animationType="slide" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>🫀 BLUTDRUCK MESSUNG</Text>
            <View style={[styles.neonBar, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>SYSTOLISCH (mmHg)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]}
              placeholder="z.B. 120"
              placeholderTextColor={theme.placeholder}
              keyboardType="numeric"
              value={systolic}
              onChangeText={setSystolic}
            />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>DIASTOLISCH (mmHg)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]}
              placeholder="z.B. 80"
              placeholderTextColor={theme.placeholder}
              keyboardType="numeric"
              value={diastolic}
              onChangeText={setDiastolic}
            />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>PULS (BPM - Optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]}
              placeholder="z.B. 72"
              placeholderTextColor={theme.placeholder}
              keyboardType="numeric"
              value={pulse}
              onChangeText={setPulse}
            />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>HINWEIS / NOTIZ (Optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]}
              placeholder="z.B. Ruhig im Sitzen gemessen"
              placeholderTextColor={theme.placeholder}
              value={bpNotes}
              onChangeText={setBpNotes}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.cyanBtn, { backgroundColor: theme.accent }]} onPress={saveBpEntry}>
                <Text style={[styles.btnText, { color: theme.btnTextColor }]}>💾 SPEICHERN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setBpModalVisible(false)}>
                <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>❌ ABBRECHEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: HISTORIE BEARBEITEN */}
      <Modal visible={logModalVisible} animationType="fade" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>✏️ HISTORIE BEARBEITEN</Text>
            <View style={[styles.neonBar, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>💊 MEDIKAMENTEN-NAME</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} value={logTitle} onChangeText={setLogTitle} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>⏰ SOLL-UHRZEIT (HH:MM)</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} value={logTime} onChangeText={setLogTime} keyboardType="numeric" maxLength={5} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>📌 STATUS</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.statusSelectBtn, logStatus === 'EINGENOMMEN' && { backgroundColor: 'rgba(16, 185, 129, 0.3)', borderColor: '#10B981' }, { borderColor: theme.cardBorder }]}
                onPress={() => setLogStatus('EINGENOMMEN')}
              >
                <Text style={{ color: logStatus === 'EINGENOMMEN' ? '#10B981' : theme.textMuted, fontWeight: '800' }}>✅ EINGENOMMEN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusSelectBtn, logStatus === 'ÜBERSPRUNGEN' && { backgroundColor: 'rgba(168, 85, 247, 0.3)', borderColor: '#A855F7' }, { borderColor: theme.cardBorder }]}
                onPress={() => setLogStatus('ÜBERSPRUNGEN')}
              >
                <Text style={{ color: logStatus === 'ÜBERSPRUNGEN' ? '#A855F7' : theme.textMuted, fontWeight: '800' }}>⏭️ ÜBERSPRUNGEN</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.cyanBtn, { backgroundColor: theme.accent }]} onPress={saveLogForm}>
                <Text style={[styles.btnText, { color: theme.btnTextColor }]}>💾 SPEICHERN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setLogModalVisible(false)}>
                <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>❌ ABBRECHEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: HILFE (AKTUALISIERT) */}
      <Modal visible={guideModalVisible} animationType="slide" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent, maxHeight: '85%' }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>📖 BEDIENUNGSANLEITUNG & HILFE</Text>
            <View style={[styles.neonBar, { backgroundColor: theme.accent, shadowColor: theme.accent, marginBottom: 10 }]} />

            <ScrollView contentContainerStyle={styles.guideContainer}>
              <View style={[styles.guideRow, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.guideHeader, { color: theme.accent }]}>1. NAVIGATION & TABS</Text>
                <Text style={[styles.guideText, { color: theme.textMain }]}>
                  Wechsle über die Kopfleiste flexibel zwischen den Bereichen **💊 MEDS** (Verwaltung & Alarme), **📊 STATISTIK** (Einnahmequote & Verlauf) und **🫀 BLUTDRUCK** (Messungen & Auswertung).
                </Text>
              </View>

              <View style={[styles.guideRow, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.guideHeader, { color: theme.accent }]}>2. PUSH-BENACHRICHTIGUNGEN</Text>
                <Text style={[styles.guideText, { color: theme.textMain }]}>
                  Erhalte pünktliche Alarme. Direkt in der Benachrichtigung kannst du auf "Nehmen", "Später" oder "Überspringen" tippen, ohne die App öffnen zu müssen.
                </Text>
              </View>

              <View style={[styles.guideRow, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.guideHeader, { color: theme.accent }]}>3. BLUTDRUCK-TAGEBUCH & ZEITRÄUME</Text>
                <Text style={[styles.guideText, { color: theme.textMain }]}>
                  Erfasse Systole, Diastole und Puls. Im Blutdruck-Tab kannst du deine Werte über die Filter-Buttons (**GESAMT**, **30 TAGE**, **7 TAGE**) prozentual nach Kategorien (Hypertonie, Hoch-Normal, Optimal) auswerten lassen.
                </Text>
              </View>

              <View style={[styles.guideRow, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.guideHeader, { color: theme.accent }]}>4. DESIGN & DUNKELMODUS</Text>
                <Text style={[styles.guideText, { color: theme.textMain }]}>
                  Mit dem Schalter oben rechts (☀️ HELL / 🌙 DUNKEL) lässt sich das Layout augenschonend anpassen. Die Einstellung wird automatisch gespeichert.
                </Text>
              </View>

              <View style={[styles.guideRow, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.guideHeader, { color: theme.accent }]}>5. DATENSICHERUNG & WIEDERHERSTELLUNG</Text>
                <Text style={[styles.guideText, { color: theme.textMain }]}>
                  Sichere deine Medikamente, Einnahme-Historien und Blutdruckwerte als JSON-Datei über "💾 SICHERN" und spiele sie bei Bedarf über "📂 LADEN" wieder ein.
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity style={[styles.closeModalBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setGuideModalVisible(false)}>
              <Text style={[styles.closeModalBtnText, { color: theme.outlineText }]}>❌ SCHLIESSEN</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL: SPÄTER / SNOOZE */}
      <Modal visible={snoozeModalVisible} animationType="fade" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>⏳ ERINNERUNG VERZÖGERN</Text>
            <Text style={[styles.modalSub, { color: theme.textSub }]}>Wähle eine Zeitspanne:</Text>

            <View style={styles.snoozeGrid}>
              <TouchableOpacity style={styles.snoozeOptionBtn} onPress={() => { executeSnooze(selectedMedForSnooze, 15); setSnoozeModalVisible(false); }}>
                <Text style={styles.snoozeOptionText}>⏱️ +15 MIN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.snoozeOptionBtn} onPress={() => { executeSnooze(selectedMedForSnooze, 30); setSnoozeModalVisible(false); }}>
                <Text style={styles.snoozeOptionText}>⏱️ +30 MIN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.snoozeOptionBtn} onPress={() => { executeSnooze(selectedMedForSnooze, 45); setSnoozeModalVisible(false); }}>
                <Text style={styles.snoozeOptionText}>⏱️ +45 MIN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.snoozeOptionBtn} onPress={() => { executeSnooze(selectedMedForSnooze, 60); setSnoozeModalVisible(false); }}>
                <Text style={styles.snoozeOptionText}>⏱️ +60 MIN</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textSub, marginTop: 16 }]}>⚙️ FREI WÄHLBAR (MINUTEN)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1, backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} placeholder="z.B. 90" placeholderTextColor={theme.placeholder} keyboardType="numeric" value={customSnoozeMinutes} onChangeText={setCustomSnoozeMinutes} />
              <TouchableOpacity style={[styles.cyanBtn, { flex: 0.8, backgroundColor: theme.accent }]} onPress={handleCustomSnoozeSubmit}>
                <Text style={[styles.btnText, { color: theme.btnTextColor }]}>OK</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.closeModalBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setSnoozeModalVisible(false)}>
              <Text style={[styles.closeModalBtnText, { color: theme.outlineText }]}>❌ ABBRECHEN</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL: MEDIKAMENT ANLEGEN / BEARBEITEN */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>
              {editingMedId ? '✏️ MEDIKAMENT BEARBEITEN' : '➕ NEUES MEDIKAMENT'}
            </Text>
            <View style={[styles.neonBar, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>💊 NAME DES MEDIKAMENTS</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} placeholder="z.B. Ibuprofen" placeholderTextColor={theme.placeholder} value={title} onChangeText={setTitle} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>🧪 DOSIERUNG</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} placeholder="z.B. 400mg / 1 Tablette" placeholderTextColor={theme.placeholder} value={dosage} onChangeText={setDosage} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>⏰ UHRZEIT (HH:MM)</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} placeholder="08:00" placeholderTextColor={theme.placeholder} value={time} onChangeText={handleTimeChange} keyboardType="numeric" maxLength={5} />

            <Text style={[styles.inputLabel, { color: theme.textSub }]}>📝 HINWEIS / NOTIZ</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} placeholder="z.B. Nach dem Essen einnehmen" placeholderTextColor={theme.placeholder} value={notes} onChangeText={setNotes} />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.cyanBtn, { backgroundColor: theme.accent }]} onPress={saveMedicationForm}>
                <Text style={[styles.btnText, { color: theme.btnTextColor }]}>💾 SPEICHERN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setModalVisible(false)}>
                <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>❌ ABBRECHEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: MANUELLE SICHERUNG */}
      <Modal visible={backupModalVisible} animationType="fade" transparent={true}>
        <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
            <Text style={[styles.modalTitle, { color: theme.accent }]}>💾 DATENSICHERUNG</Text>
            <TextInput style={[styles.input, styles.textArea, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textMain }]} multiline numberOfLines={8} value={rawJsonText} onChangeText={setRawJsonText} placeholder="Sicherungscode..." placeholderTextColor={theme.placeholder} />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.cyanBtn, { backgroundColor: theme.accent }]} onPress={() => processImportData(rawJsonText)}>
                <Text style={[styles.btnText, { color: theme.btnTextColor }]}>📂 LADEN</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.outlineBorder, backgroundColor: theme.outlineBg }]} onPress={() => setBackupModalVisible(false)}>
                <Text style={[styles.outlineBtnText, { color: theme.outlineText }]}>❌ SCHLIESSEN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// FARBPALETTEN
const lightColors = {
  bg: '#F8FAFC',
  cardBg: '#FFFFFF',
  cardBorder: '#CBD5E1',
  textMain: '#0F172A',
  textSub: '#475569',
  textMuted: '#64748B',
  accent: '#0284C7',
  btnTextColor: '#FFFFFF',
  tabInactiveBg: '#E2E8F0',
  outlineBorder: '#0284C7',
  outlineBg: 'rgba(2, 132, 199, 0.06)',
  outlineText: '#0284C7',
  inputBg: '#F1F5F9',
  placeholder: '#94A3B8',
  modalOverlay: 'rgba(15, 23, 42, 0.5)',
};

const darkColors = {
  bg: '#030712',
  cardBg: '#0B1528',
  cardBorder: '#1E293B',
  textMain: '#F8FAFC',
  textSub: '#94A3B8',
  textMuted: '#64748B',
  accent: '#00F0FF',
  btnTextColor: '#030712',
  tabInactiveBg: '#0F172A',
  outlineBorder: '#38BDF8',
  outlineBg: 'rgba(56, 189, 248, 0.05)',
  outlineText: '#38BDF8',
  inputBg: '#030712',
  placeholder: '#64748B',
  modalOverlay: 'rgba(3, 7, 18, 0.85)',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginRight: 8,
  },
  themeToggleContainer: {
    alignItems: 'center',
  },
  themeLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  neonBar: {
    height: 2,
    marginTop: 10,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  mainTabRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    gap: 6,
  },
  mainTabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  tabContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabEmoji: {
    fontSize: 14,
  },
  mainTabText: {
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.3,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginVertical: 10,
    gap: 6,
  },
  cyanBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontWeight: '900',
    letterSpacing: 0.5,
    fontSize: 10,
  },
  outlineBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontWeight: '800',
    letterSpacing: 0.5,
    fontSize: 9,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  emptyCard: {
    borderWidth: 1,
    padding: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    letterSpacing: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  emptySubText: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardInactive: {
    opacity: 0.45,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  timeBadge: {
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  cardTime: {
    color: '#10B981',
    fontWeight: '800',
    letterSpacing: 1,
    fontSize: 13,
  },
  cardTitle: {
    fontWeight: '900',
    fontSize: 17,
    letterSpacing: 1,
  },
  cardBody: {
    marginTop: 8,
  },
  cardSub: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  cardNotes: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  cardFooterContainer: {
    marginTop: 14,
    gap: 8,
  },
  cardFooterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greenBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  amberBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  purpleBtn: {
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    borderWidth: 1,
    borderColor: '#A855F7',
  },
  blueBtn: {
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
    borderWidth: 1,
    borderColor: '#0284C7',
  },
  redBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  smallBtnTextGreen: { color: '#10B981', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  smallBtnTextAmber: { color: '#F59E0B', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  smallBtnTextPurple: { color: '#A855F7', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  smallBtnTextBlue: { color: '#0284C7', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  smallBtnTextRed: { color: '#EF4444', fontSize: 9, fontWeight: '800', textAlign: 'center' },

  statsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 4,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginVertical: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '900',
  },
  statTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 4,
    textAlign: 'center',
  },
  statSubText: {
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 12,
  },

  // STYLES BLUTDRUCK STATISTIK
  timeframeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  timeframeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  timeframeBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  bpStatsCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  bpStatsTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  bpBarContainer: {
    height: 12,
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 12,
  },
  bpBarSegment: {
    height: '100%',
  },
  bpPctGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bpPctItem: {
    alignItems: 'center',
  },
  bpAvgRow: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  logItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  logTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  logDate: {
    fontSize: 10,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeTaken: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  badgeSkipped: { backgroundColor: 'rgba(168, 85, 247, 0.15)' },
  badgeTextTaken: { color: '#10B981', fontSize: 9, fontWeight: '900' },
  badgeTextSkipped: { color: '#A855F7', fontSize: 9, fontWeight: '900' },

  badgeGreen: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  badgeAmber: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  badgeRed: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  badgeTextGreen: { color: '#10B981', fontSize: 9, fontWeight: '900' },
  badgeTextAmber: { color: '#F59E0B', fontSize: 9, fontWeight: '900' },
  badgeTextRed: { color: '#EF4444', fontSize: 9, fontWeight: '900' },

  logActionBtn: { padding: 4 },
  statusSelectBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  developerFooter: {
    borderTopWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  developerText: {
    fontSize: 10,
    fontWeight: '600',
  },
  snoozeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  snoozeOptionBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  snoozeOptionText: {
    color: '#F59E0B',
    fontWeight: '900',
  },
  closeModalBtn: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
  },
  closeModalBtnText: {
    fontWeight: '800',
    fontSize: 11,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 20,
  },
  modalTitle: {
    fontWeight: '900',
    fontSize: 15,
  },
  modalSub: {
    fontSize: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
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
  guideContainer: {
    paddingVertical: 5,
  },
  guideRow: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  guideHeader: {
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 4,
  },
  guideText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
