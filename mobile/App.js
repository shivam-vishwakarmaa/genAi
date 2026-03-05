import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";

export default function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");

  // Handles the PDF selection
  // Handles the PDF selection and uploads it to the local backend
  const pickDocument = async () => {
    try {
      let result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
      });

      if (!result.canceled) {
        const file = result.assets[0];
        setPdfFile(file);

        // Let the user know the upload started
        setMessages((prev) => [
          ...prev,
          {
            text: `System: "${file.name}" selected. Uploading to local AI server...`,
            isUser: false,
          },
        ]);

        // 1. Prepare the file data
        const formData = new FormData();

        // React Native needs the uri, name, and type to properly construct the file blob
        if (Platform.OS === "web") {
          // On the web, Expo hides the raw file inside the 'file' property
          formData.append("document", file.file);
        } else {
          // On a physical phone, we construct it like this
          formData.append("document", {
            uri: file.uri,
            name: file.name,
            type: file.mimeType || "application/pdf",
          });
        }

        // 2. Send it to your Express backend
        // Note: Because we are running on the web simulator on the same laptop, 'localhost' works perfectly.
        const response = await fetch("http://localhost:3000/api/upload", {
          method: "POST",
          body: formData,
          headers: {
            Accept: "application/json",
            // Note: We do NOT set 'Content-Type': 'multipart/form-data' here.
            // Fetch automatically sets it along with the correct boundary string.
          },
        });

        const data = await response.json();

        // 3. Update the chat UI based on the backend response
        if (response.ok) {
          setMessages((prev) => [
            ...prev,
            { text: `System: Success! ${data.message}`, isUser: false },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { text: `System: Error uploading! ${data.error}`, isUser: false },
          ]);
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      setMessages((prev) => [
        ...prev,
        {
          text: `System: Critical error uploading document. Is the backend running?`,
          isUser: false,
        },
      ]);
    }
  };

  // Handles sending a chat message
  // Handles sending a chat message to the local AI
  const sendMessage = async () => {
    if (inputText.trim() === "") return;

    const userMessage = inputText;
    // Add the user's question to the chat immediately
    setMessages((prev) => [...prev, { text: userMessage, isUser: true }]);
    setInputText("");

    // Show a loading state
    setMessages((prev) => [
      ...prev,
      {
        text: "Thinking... (Searching notes locally)",
        isUser: false,
        isLoading: true,
      },
    ]);

    try {
      const response = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMessage }),
      });

      const data = await response.json();

      // Remove the loading message and add the real response
      setMessages((prev) => {
        const filtered = prev.filter((msg) => !msg.isLoading);
        if (response.ok) {
          return [
            ...filtered,
            {
              text: `${data.answer}\n\nSources: [${data.sources}]`,
              isUser: false,
            },
          ];
        } else {
          return [...filtered, { text: `Error: ${data.error}`, isUser: false }];
        }
      });
    } catch (error) {
      setMessages((prev) => {
        const filtered = prev.filter((msg) => !msg.isLoading);
        return [
          ...filtered,
          { text: "Critical error connecting to AI.", isUser: false },
        ];
      });
    }
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
            {pdfFile ? "📄 " + pdfFile.name : "📁 Upload Handwritten PDF"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Chat History Area */}
      <ScrollView style={styles.chatArea}>
        {messages.map((msg, index) => (
          <View
            key={index}
            style={[
              styles.messageBubble,
              msg.isUser ? styles.userBubble : styles.aiBubble,
            ]}
          >
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
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: {
    padding: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
  },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: "#333" },
  uploadSection: { padding: 15, alignItems: "center" },
  uploadBtn: {
    backgroundColor: "#4f46e5",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
  },
  uploadBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  chatArea: { flex: 1, padding: 15 },
  messageBubble: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    maxWidth: "85%",
  },
  userBubble: {
    backgroundColor: "#e0e7ff",
    alignSelf: "flex-end",
    borderBottomRightRadius: 0,
  },
  aiBubble: {
    backgroundColor: "#ffffff",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 0,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  messageText: { fontSize: 15, color: "#333", lineHeight: 22 },
  inputSection: {
    flexDirection: "row",
    padding: 15,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderColor: "#e0e0e0",
  },
  input: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    padding: 12,
    borderRadius: 8,
    marginRight: 10,
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: "#4f46e5",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: "center",
  },
  sendBtnText: { color: "#ffffff", fontWeight: "bold" },
});
