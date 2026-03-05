import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

export default function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');

  // Handles the PDF selection
  const pickDocument = async () => {
    let result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
    });
    
    if (!result.canceled) {
      setPdfFile(result.assets[0]);
      setMessages([...messages, { text: `System: "${result.assets[0].name}" selected. Ready to process.`, isUser: false }]);
    }
  };

  // Handles sending a chat message
  const sendMessage = () => {
    if (inputText.trim() === '') return;
    
    // Add the user's question to the chat
    const newMessages = [...messages, { text: inputText, isUser: true }];
    setMessages(newMessages);
    setInputText('');

    // Mock AI response to show the UI behavior
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        text: "This is a placeholder answer based only on your notes. \n\nSource: [Page 1, Section A]", 
        isUser: false 
      }]);
    }, 1000);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Study Assistant AI</Text>
      </View>

      {/* Upload Section */}
      <View style={styles.uploadSection}>
        <TouchableOpacity style={styles.uploadBtn} onPress={pickDocument}>
          <Text style={styles.uploadBtnText}>
            {pdfFile ? '📄 ' + pdfFile.name : '📁 Upload Handwritten PDF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Chat History Area */}
      <ScrollView style={styles.chatArea}>
        {messages.map((msg, index) => (
          <View key={index} style={[styles.messageBubble, msg.isUser ? styles.userBubble : styles.aiBubble]}>
            <Text style={styles.messageText}>{msg.text}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Text Input Area */}
      <View style={styles.inputSection}>
        <TextInput
          style={styles.input}
          placeholder="Ask a question about your notes..."
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 20, backgroundColor: '#ffffff', borderBottomWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  uploadSection: { padding: 15, alignItems: 'center' },
  uploadBtn: { backgroundColor: '#4f46e5', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, width: '100%', alignItems: 'center' },
  uploadBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  chatArea: { flex: 1, padding: 15 },
  messageBubble: { padding: 15, borderRadius: 10, marginBottom: 10, maxWidth: '85%' },
  userBubble: { backgroundColor: '#e0e7ff', alignSelf: 'flex-end', borderBottomRightRadius: 0 },
  aiBubble: { backgroundColor: '#ffffff', alignSelf: 'flex-start', borderBottomLeftRadius: 0, borderWidth: 1, borderColor: '#e0e0e0' },
  messageText: { fontSize: 15, color: '#333', lineHeight: 22 },
  inputSection: { flexDirection: 'row', padding: 15, backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#e0e0e0' },
  input: { flex: 1, backgroundColor: '#f3f4f6', padding: 12, borderRadius: 8, marginRight: 10, fontSize: 15 },
  sendBtn: { backgroundColor: '#4f46e5', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, justifyContent: 'center' },
  sendBtnText: { color: '#ffffff', fontWeight: 'bold' }
});