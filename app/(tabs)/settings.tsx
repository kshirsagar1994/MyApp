import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Switch, ScrollView, TextInput, Appearance, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [saveToInternal, setSaveToInternal] = useState(true);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userName, setUserName] = useState('AIOD User');
  const [userPhone, setUserPhone] = useState('+1 9876543210');
  const [dob, setDob] = useState('01 Jan 2000');
  const [nationality, setNationality] = useState('Indian');
  const [profileAvatar, setProfileAvatar] = useState('https://ui-avatars.com/api/?name=User&background=random');
  const [igSessionId, setIgSessionId] = useState('');

  useEffect(() => {
    // ── PERFORMANCE: Single multiGet instead of 5 individual getItem calls
    const loadProfile = async () => {
      try {
        const keys = ['userName', 'userPhone', 'dob', 'nationality', 'profileAvatar', 'igSessionId'];
        const results = await AsyncStorage.multiGet(keys);
        const data: Record<string, string | null> = {};
        results.forEach(([key, value]) => { data[key] = value; });
        
        if (data.userName) setUserName(data.userName);
        if (data.userPhone) setUserPhone(data.userPhone);
        if (data.dob) setDob(data.dob);
        if (data.nationality) setNationality(data.nationality);
        if (data.profileAvatar) setProfileAvatar(data.profileAvatar);
        if (data.igSessionId) setIgSessionId(data.igSessionId);
      } catch (e) {
        // Silent fail — defaults remain
      }
    };
    loadProfile();
  }, []);

  // ── PERFORMANCE: Stable callbacks via useCallback — prevents child re-renders
  const handleSaveProfile = useCallback(async () => {
    if (isEditingProfile) {
      try {
        await AsyncStorage.multiSet([
          ['userName', userName],
          ['userPhone', userPhone],
          ['dob', dob],
          ['nationality', nationality],
          ['igSessionId', igSessionId],
        ]);
        Alert.alert('Success', 'Profile saved successfully!');
      } catch {
        Alert.alert('Error', 'Failed to save profile');
      }
    }
    setIsEditingProfile(!isEditingProfile);
  }, [isEditingProfile, userName, userPhone, dob, nationality]);

  const handleChangePhoto = useCallback(async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      setProfileAvatar(uri);
      try {
        await AsyncStorage.setItem('profileAvatar', uri);
      } catch (e) {
        // Silent fail
      }
    }
  }, []);

  // Use the system theme hook here just to display state, although toggling it 
  // explicitly in real app requires custom Context holding theme mode instead of useColorScheme directly.
  const [isDarkModeEnabled, setIsDarkModeEnabled] = useState(isDark);

  const toggleDarkMode = useCallback((value: boolean) => {
    setIsDarkModeEnabled(value);
    Appearance.setColorScheme(value ? 'dark' : 'light');
  }, []);

  // ── PERFORMANCE: Memoize theme colors — avoids new object allocation every render
  const themeColors = useMemo(() => ({
    bg: isDark ? '#050B14' : '#f5f5f5',
    card: isDark ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
    text: isDark ? '#ffffff' : '#333333',
    subText: isDark ? '#8FA1B3' : '#666666',
    border: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e0e0e0',
    danger: '#FF3B30',
  }), [isDark]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.bg }]}>
      
      {/* Profile Section */}
      <View style={[styles.profileCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
        <View style={styles.avatarContainer}>
           <Image 
             source={{ uri: profileAvatar }} 
             style={styles.avatar} 
           />
           {isEditingProfile && (
             <TouchableOpacity style={styles.editAvatarBtn} onPress={handleChangePhoto}>
               <Ionicons name="camera" size={16} color="#fff" />
             </TouchableOpacity>
           )}
        </View>
        {isEditingProfile ? (
           <TextInput
              style={[styles.userNameInput, { color: themeColors.text, borderColor: themeColors.border }]}
              value={userName}
              onChangeText={setUserName}
           />
        ) : (
           <Text style={[styles.userName, { color: themeColors.text }]}>{userName}</Text>
        )}
        
        {isEditingProfile ? (
           <TextInput
              style={[styles.userPhoneInput, { color: themeColors.text, borderColor: themeColors.border }]}
              value={userPhone}
              onChangeText={setUserPhone}
              keyboardType="phone-pad"
           />
        ) : (
           <Text style={[styles.userPhone, { color: themeColors.subText }]}>{userPhone}</Text>
        )}

        <View style={styles.detailsList}>
           <View style={styles.detailItem}>
             <Text style={[styles.detailLabel, { color: themeColors.subText }]}>Date of Birth:</Text>
             {isEditingProfile ? (
                <TextInput style={[styles.inputField, { color: themeColors.text, borderColor: themeColors.border }]} value={dob} onChangeText={setDob} />
             ) : (
                <Text style={[styles.detailValue, { color: themeColors.text }]}>{dob}</Text>
             )}
           </View>
           <View style={styles.detailItem}>
             <Text style={[styles.detailLabel, { color: themeColors.subText }]}>Nationality:</Text>
             {isEditingProfile ? (
                 <TextInput style={[styles.inputField, { color: themeColors.text, borderColor: themeColors.border }]} value={nationality} onChangeText={setNationality} />
             ) : (
                 <Text style={[styles.detailValue, { color: themeColors.text }]}>{nationality}</Text>
             )}
           </View>
        </View>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
           <Text style={styles.saveBtnText}>{isEditingProfile ? 'Save Profile' : 'Edit Profile'}</Text>
        </TouchableOpacity>
      </View>

      {/* App Settings Section */}
      <View style={[styles.settingsCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
         <Text style={[styles.sectionTitle, { color: themeColors.subText }]}>APP SETTINGS</Text>

         <View style={[styles.settingRow, styles.settingRowBorder, { borderBottomColor: themeColors.border }]}>
            <View style={styles.settingLabelRow}>
               <Ionicons name={isDarkModeEnabled ? "moon" : "sunny"} size={22} color={themeColors.text} style={styles.settingIcon} />
               <Text style={[styles.settingText, { color: themeColors.text }]}>Dark Mode</Text>
            </View>
            <Switch 
               value={isDarkModeEnabled} 
               onValueChange={toggleDarkMode} 
               trackColor={{ false: '#767577', true: '#34C759' }}
            />
         </View>

         <View style={styles.settingRow}>
            <View style={[styles.settingLabelRow, styles.settingLabelFlex]}>
               <Ionicons name="folder" size={22} color={themeColors.text} style={styles.settingIcon} />
               <View style={styles.settingTextContainer}>
                 <Text style={[styles.settingText, { color: themeColors.text }]}>Save to Internal Storage</Text>
                 {saveToInternal && (
                   <Text style={[styles.storagePath, { color: themeColors.subText }]}>
                     /storage/emulated/0/Download/MyApp
                   </Text>
                 )}
               </View>
            </View>
            <Switch 
               value={saveToInternal} 
               onValueChange={setSaveToInternal}
               trackColor={{ false: '#767577', true: '#34C759' }}
            />
         </View>

         <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start', paddingTop: 20 }]}>
            <View style={[styles.settingLabelRow, { marginBottom: 10 }]}>
               <Ionicons name="key" size={22} color={themeColors.text} style={styles.settingIcon} />
               <Text style={[styles.settingText, { color: themeColors.text }]}>Instagram Session ID</Text>
            </View>
            <Text style={[styles.storagePath, { color: themeColors.subText, marginBottom: 12 }]}>
               Required to download private Instagram posts. Paste your 'sessionid' cookie value here.
            </Text>
            <TextInput
               style={[styles.inputField, { color: themeColors.text, borderColor: themeColors.border, width: '100%', textAlign: 'left', paddingVertical: 10, paddingHorizontal: 12 }]}
               value={igSessionId}
               onChangeText={setIgSessionId}
               placeholder="Paste sessionid here..."
               placeholderTextColor={themeColors.subText}
               secureTextEntry
               onBlur={() => {
                 AsyncStorage.setItem('igSessionId', igSessionId).catch(() => {});
               }}
            />
         </View>
      </View>

      <View style={styles.versionContainer}>
         <Text style={[styles.versionText, { color: themeColors.subText }]}>App Version 1.0.0</Text>
         <Text style={[styles.versionSubtext, { color: themeColors.subText }]}>MyApp AIOD System</Text>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  profileCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#007AFF',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userPhone: {
    fontSize: 16,
    marginBottom: 20,
  },
  detailsList: {
    width: '100%',
    marginBottom: 24,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontWeight: '600',
    marginTop: 8,
  },
  detailValue: {
    marginTop: 8,
  },
  inputField: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 140,
    textAlign: 'right',
  },
  userNameInput: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    textAlign: 'center',
    minWidth: 150,
  },
  userPhoneInput: {
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    textAlign: 'center',
    minWidth: 150,
  },
  saveBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  settingsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
  },
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingLabelFlex: {
    flex: 1,
  },
  settingIcon: {
    marginRight: 10,
  },
  settingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  storagePath: {
    fontSize: 11,
    marginTop: 4,
  },
  versionContainer: {
    alignItems: 'center',
    marginVertical: 10,
    paddingBottom: 20,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  versionSubtext: {
    fontSize: 11,
    marginTop: 4,
  },
  bottomSpacer: {
    height: 40,
  },
});
