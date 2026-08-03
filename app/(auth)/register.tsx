import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import axios from 'axios';
import { SERVER_URL } from '../(tabs)';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleRegister = async () => {
    if (!email || !password) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    try {
      const response = await axios.post(`${SERVER_URL}/api/auth/register`, { email, password });
      await login(response.data.token, response.data.user);
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Registration Failed', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      
      <TextInput 
        style={styles.input} 
        placeholder="Email" 
        placeholderTextColor="#888" 
        keyboardType="email-address" 
        autoCapitalize="none" 
        value={email}
        onChangeText={setEmail}
      />
      <TextInput 
        style={styles.input} 
        placeholder="Password" 
        placeholderTextColor="#888" 
        secureTextEntry 
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
      </TouchableOpacity>

      <View style={styles.linkContainer}>
        <Text style={styles.text}>Already have an account? </Text>
        <Link href="/(auth)/login" asChild>
          <TouchableOpacity><Text style={styles.link}>Log In</Text></TouchableOpacity>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#1E1E1E' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 40, textAlign: 'center' },
  input: { backgroundColor: '#333', color: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16 },
  button: { backgroundColor: '#0a7ea4', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  linkContainer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  text: { color: '#aaa' },
  link: { color: '#0a7ea4', fontWeight: 'bold' }
});
