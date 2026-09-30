import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, TextInput, Button, Text, FlatList, StyleSheet, Alert } from 'react-native';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import { initDb, insertRecord, getAllRecords, getUnsyncedRecords, markSynced } from './db';
import { syncAllPending } from './sync';

export default function App() {
  const [input, setInput] = useState('');
  const [records, setRecords] = useState([]);
  const isSyncingRef = useRef(false);

  const refresh = useCallback(() => {
    setRecords(getAllRecords());
  }, []);

  useEffect(() => {
    initDb();
    refresh();

    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && !isSyncingRef.current) {
        handleSync();
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSubmit = () => {
    if (!input.trim()) return;
    const id = Crypto.randomUUID();
    insertRecord(id, input.trim());
    setInput('');
    refresh();
  };

  const handleSync = async () => {
    if (isSyncingRef.current) return; // covers the manual "Sync now" button too
    isSyncingRef.current = true;
    try {
      const results = await syncAllPending(getUnsyncedRecords, markSynced);
      console.log('SYNC RESULTS:', JSON.stringify(results, null, 2));
      refresh();
      Alert.alert('Sync done', `${results.length} record(s) processed`);
    } finally {
      isSyncingRef.current = false;
    }
  };


  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Enter test data"
        value={input}
        onChangeText={setInput}
      />
      <Button title="Submit (save locally)" onPress={handleSubmit} />
      <Button title="Sync now" onPress={handleSync} />

      <FlatList
        style={styles.list}
        data={records}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <Text>{item.payload} — {item.synced ? '✅ synced :>' : '⏳ pending :| '}</Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 8, marginBottom: 8, borderRadius: 4 },
  list: { marginTop: 16 },
});