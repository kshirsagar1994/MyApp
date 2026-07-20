import React, { useState, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, Platform, Image, useColorScheme, Alert, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { documentDirectory, createDownloadResumable } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import Animated, { FadeInDown } from 'react-native-reanimated';

// ── PERFORMANCE: Memoized media option item — prevents all options from
// re-rendering when download progress triggers activeDownloads state change
const MediaOptionItem = React.memo(({ opt, index, isDark, themeColors, onDownload, onPlaylistDownload }: {
  opt: any; index: number; isDark: boolean; themeColors: any;
  onDownload: (opt: any, type?: 'image' | 'video') => void;
  onPlaylistDownload: (opt: any) => void;
}) => (
  <View style={[styles.mediaItem, { backgroundColor: isDark ? '#1F2937' : '#f9f9f9' }]}>
    {(opt.imageUrl || opt.isImage) && (
      <Image source={{ uri: opt.imageUrl || opt.url }} style={styles.mediaPreview} resizeMode="cover" />
    )}
    <View style={styles.mediaInfo}>
      <Text style={[styles.mediaQuality, { color: themeColors.text }]} numberOfLines={2}>{opt.quality}</Text>
      <Text style={styles.mediaMeta}>{opt.size} • {opt.format}</Text>
      {opt.note ? <Text style={styles.noteText}>{opt.note}</Text> : null}
    </View>
    <View style={styles.mediaActions}>
      {opt.isPlaylist ? (
        <TouchableOpacity
          style={[styles.dualBtn, { backgroundColor: opt.playlistFormat === 'audio' ? '#8B5CF6' : '#10B981' }]}
          onPress={() => onPlaylistDownload(opt)}
        >
          <Text style={styles.dualBtnText}>
            {opt.playlistFormat === 'audio' ? '🎵 Download All' : '🎥 Download All'}
          </Text>
        </TouchableOpacity>
      ) : opt.isImage ? (
        <TouchableOpacity style={[styles.dualBtn, { backgroundColor: '#3B82F6' }]} onPress={() => onDownload(opt, 'image')}>
          <Text style={styles.dualBtnText}>🖼️ Download</Text>
        </TouchableOpacity>
      ) : (opt.isAudio || opt.format === 'MP3') ? (
        <TouchableOpacity style={[styles.dualBtn, { backgroundColor: '#8B5CF6' }]} onPress={() => onDownload(opt)}>
          <Text style={styles.dualBtnText}>🎵 Download</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={[styles.dualBtn, { backgroundColor: '#10B981' }]} onPress={() => onDownload(opt, 'video')}>
          <Text style={styles.dualBtnText}>🎥 Download</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
));

// ========== SERVER CONFIGURATION ==========
// Using ADB reverse proxy: `adb reverse tcp:3000 tcp:3000`
// This tunnels phone's localhost:3000 → PC's localhost:3000 via USB cable.
const SERVER_IP = '192.168.31.155';
const SERVER_PORT = 3000; // MUST MATCH THE PORT YOUR BACKEND IS RUNNING ON

/** Resolves the backend server base URL */
const getServerBaseUrl = (): string => {
  // We force the local IP address for physical devices on WiFi to connect to the PC's server
  return `http://${SERVER_IP}:${SERVER_PORT}`;
};

export default function HomeScreen() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeDownloads, setActiveDownloads] = useState<any[]>([]);
  // YouTube download modal state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedDownloadTab, setSelectedDownloadTab] = useState<'video' | 'audio'>('video');
  
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // ── PERFORMANCE: Memoize theme colors so they don't recreate every render
  const themeColors = useMemo(() => ({
    bg: isDark ? '#050B14' : '#F2F2F7',
    text: isDark ? '#FFFFFF' : '#000000',
    subText: isDark ? '#8FA1B3' : '#6B7280',
    border: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    primary: '#3B82F6',
    secondary: '#10B981',
  }), [isDark]);

  // ── PERFORMANCE: Throttle ref to prevent download progress from firing
  // 30-60 times/sec — limits to max 3 updates/sec (saves ~90% re-renders)
  const lastProgressUpdate = useRef<Record<string, number>>({});
  
  // ── DOWNLOAD CONTROL: Store resumable instances to allow pause/cancel
  const downloadTasks = useRef<Record<string, any>>({});

  /** Save a completed file to MediaLibrary (gallery + file manager) */
  const saveToGalleryAndStorage = useCallback(async (fileUri: string, fileName: string, finalExt: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      const mimeType = finalExt === '.jpg' ? 'image/jpeg' : (finalExt === '.m4a' || finalExt === '.mp3') ? 'audio/mp4' : 'video/mp4';
      const UTI = finalExt === '.jpg' ? 'public.jpeg' : (finalExt === '.m4a' || finalExt === '.mp3') ? 'public.mpeg-4-audio' : 'public.mpeg-4';

      if (status !== 'granted') {
        // Permission denied — use share sheet as fallback
        await Sharing.shareAsync(fileUri, { mimeType, UTI });
        return;
      }

      // Create an asset which saves it to device storage (DCIM)
      const asset = await MediaLibrary.createAssetAsync(fileUri);

      // Move into an app-specific album visible in gallery & file manager
      let album = await MediaLibrary.getAlbumAsync('MyApp');
      if (album === null) {
        await MediaLibrary.createAlbumAsync('MyApp', asset, true);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, true);
      }

      const typeLabel = finalExt === '.jpg' ? 'Photo' : (finalExt === '.m4a' || finalExt === '.mp3') ? 'Audio' : 'Video';
      Alert.alert('Download Complete ✅', `${typeLabel} saved!\n\nFind it in:\n• Gallery → "MyApp" album\n• File Manager → DCIM/MyApp`);
    } catch (e: any) {
      console.log('MediaLibrary Error:', e.message);
      // Ultimate fallback: share dialog which has "Save to Files"
      try { 
        const mimeType = finalExt === '.jpg' ? 'image/jpeg' : (finalExt === '.m4a' || finalExt === '.mp3') ? 'audio/mp4' : 'video/mp4';
        const UTI = finalExt === '.jpg' ? 'public.jpeg' : (finalExt === '.m4a' || finalExt === '.mp3') ? 'public.mpeg-4-audio' : 'public.mpeg-4';
        await Sharing.shareAsync(fileUri, { mimeType, UTI }); 
      } catch (_) {}
    }
  }, []);

  const handleStartDownload = async (opt: any, typeOverride?: 'image' | 'video') => {
    // Determine the source URL based on button pressed
    const directUrl = typeOverride === 'image' ? (opt.imageUrl || opt.url) : (typeOverride === 'video' ? (opt.videoUrl || opt.url) : opt.url);

    // Allow if there's a direct URL OR if we can use the proxy
    if (!directUrl && !opt.useProxy) {
      Alert.alert('Error', 'Media URL not found.');
      return;
    }

    // Determine file extension
    let finalExt = '.mp4';
    // We force audio to save as .mp4 because Expo MediaLibrary on Android strictly 
    // rejects .m4a/.mp3 files when saving to generic albums like DCIM.
    // It will play perfectly as an audio-only video.
    const isAudioOption = opt.isAudio || opt.format === 'MP3' || opt.format === 'M4A' || opt.quality?.toLowerCase().includes('audio');
    if (typeOverride === 'image' || opt.isImage || opt.quality?.toLowerCase().includes('photo')) {
      finalExt = '.jpg';
    } else {
      finalExt = '.mp4'; 
    }

    // Clean filename (preserve spaces, remove only invalid filename characters)
    let baseName = opt.title || result?.title || 'Media';
    if (opt.quality && /^\d+\.\s/.test(opt.quality) && !opt.quality.includes('Entire Playlist')) {
       // If it's a playlist item, the title is inside opt.quality as "1. Title"
       baseName = opt.quality.replace(/^\d+\.\s*/, '');
    }
    
    let cleanTitle = baseName.replace(/[/\\?%*:|"<>#]/g, '-').trim();
    if (cleanTitle.length > 50) cleanTitle = cleanTitle.substring(0, 50).trim();
    if (!cleanTitle) cleanTitle = 'Media';
    
    // Use the exact title without a random suffix as requested
    const fileName = `${cleanTitle}${finalExt}`;

    const newDownload = {
      id: Date.now().toString(),
      title: opt.quality?.substring(0, 50) || fileName,
      progress: 0,
      speed: 'Starting...',
      isPaused: false,
    };
    setActiveDownloads(prev => [...prev, newDownload]);

    // Build proxy URL
    const baseUrl = getServerBaseUrl();
    const proxyParams = new URLSearchParams({ filename: fileName });
    if (opt.ytId) proxyParams.set('ytId', opt.ytId);
    if (opt.itag) proxyParams.set('itag', String(opt.itag));
    if (opt.playlistUrl) proxyParams.set('playlistUrl', opt.playlistUrl);
    if (opt.playlistFormat) proxyParams.set('playlistFormat', opt.playlistFormat);
    if (opt.genericUrl) proxyParams.set('genericUrl', opt.genericUrl);
    if (directUrl) proxyParams.set('url', directUrl);
    const proxyUrl = `${baseUrl}/api/media/download?${proxyParams.toString()}`;

    // Decide which URL to actually download from
    const shouldUseProxy = opt.useProxy || Platform.OS === 'web';
    const downloadUrl = shouldUseProxy ? proxyUrl : directUrl;

    // ===== WEB DOWNLOAD =====
    if (Platform.OS === 'web') {
      try {
        const progressInterval = setInterval(() => {
          setActiveDownloads(prev => prev.map(d => {
            if (d.id === newDownload.id && d.progress < 90) {
              return { ...d, progress: d.progress + 10, speed: 'Downloading...' };
            }
            return d;
          }));
        }, 500);

        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        
        const blob = await response.blob();
        clearInterval(progressInterval);
        
        setActiveDownloads(prev => prev.map(d => d.id === newDownload.id ? { ...d, progress: 100, speed: 'Complete!' } : d));
        
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        
        setTimeout(() => {
          setActiveDownloads(prev => prev.filter(d => d.id !== newDownload.id));
        }, 1500);

        const data = await AsyncStorage.getItem('downloads');
        const existing = data ? JSON.parse(data) : [];
        const completed = {
          id: newDownload.id,
          title: fileName,
          status: 'completed',
          type: finalExt === '.jpg' ? 'image' : finalExt === '.mp3' ? 'music' : 'video',
          size: blob.size ? (blob.size / 1024 / 1024).toFixed(1) + ' MB' : (opt.size || 'HQ'),
        };
        await AsyncStorage.setItem('downloads', JSON.stringify([completed, ...existing]));
        Alert.alert('Download complete! ✅', 'File saved.');
      } catch (e: any) {
        console.error('Web download error:', e);
        Alert.alert('Download Failed ❌', e.message);
        setActiveDownloads(prev => prev.filter(d => d.id !== newDownload.id));
      }
      return;
    }

    // ===== NATIVE DOWNLOAD (Android/iOS) =====
    const fileUri = (documentDirectory || '') + fileName;
    const downloadHeaders: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    };
    if (!shouldUseProxy && (directUrl?.includes('instagram.com') || directUrl?.includes('fbcdn.net'))) {
      downloadHeaders['Referer'] = 'https://www.instagram.com/';
    }

    const downloadResumable = createDownloadResumable(
      downloadUrl,
      fileUri,
      { headers: downloadHeaders },
      (downloadProgress) => {
        // ── PERFORMANCE: Throttle to max 3 updates/sec
        const now = Date.now();
        const lastUpdate = lastProgressUpdate.current[newDownload.id] || 0;
        if (now - lastUpdate < 333) return; // Skip if less than 333ms since last update
        lastProgressUpdate.current[newDownload.id] = now;

        const totalExpected = downloadProgress.totalBytesExpectedToWrite;
        const totalWritten = downloadProgress.totalBytesWritten;
        // totalExpected can be -1 for chunked/streamed downloads (like yt-dlp output)
        const progress = totalExpected > 0 ? Math.round((totalWritten / totalExpected) * 100) : -1;
        const speed = (totalWritten / 1024 / 1024).toFixed(2) + ' MB';
        setActiveDownloads(prev => prev.map(d =>
          d.id === newDownload.id && !d.isPaused
            ? { ...d, progress: progress >= 0 ? progress : 0, speed: progress >= 0 ? `${speed} (${progress}%)` : `${speed} downloaded` }
            : d
        ));
      }
    );

    downloadTasks.current[newDownload.id] = downloadResumable;

    try {
      const downloadResult = await downloadResumable.downloadAsync();
      
      // If it was cancelled, the task is removed from activeDownloads already, so just return
      if (!downloadTasks.current[newDownload.id]) return;

      delete downloadTasks.current[newDownload.id];
      setActiveDownloads(prev => prev.filter(d => d.id !== newDownload.id));
      
      if (downloadResult && downloadResult.status === 200 && downloadResult.uri) {
        // Save to gallery and file manager
        await saveToGalleryAndStorage(downloadResult.uri, fileName, finalExt);

        // Save to internal app download history (bounded to 200 items)
        try {
          const data = await AsyncStorage.getItem('downloads');
          const existing = data ? JSON.parse(data) : [];
          const completed = {
            id: newDownload.id,
            title: fileName,
            status: 'completed',
            type: finalExt === '.jpg' ? 'image' : isAudioOption ? 'music' : 'video',
            size: opt.size || 'HQ',
            uri: downloadResult.uri,
          };
          const bounded = [completed, ...existing].slice(0, 200);
          await AsyncStorage.setItem('downloads', JSON.stringify(bounded));
        } catch (err) {
          console.log('Storage Error', err);
        }
      } else {
        Alert.alert('Download Failed ❌', 'Server returned an unexpected response.');
      }
    } catch (e: any) {
      console.error(e);
      if (downloadTasks.current[newDownload.id]) {
        Alert.alert('Download Failed ❌', e.message || 'Unknown error');
        delete downloadTasks.current[newDownload.id];
        setActiveDownloads(prev => prev.filter(d => d.id !== newDownload.id));
      }
    }
  };

  const handlePauseResume = async (id: string, isPaused: boolean) => {
    const task = downloadTasks.current[id];
    if (!task) return;
    try {
      if (isPaused) {
        setActiveDownloads(prev => prev.map(d => d.id === id ? { ...d, isPaused: false, speed: 'Resuming...' } : d));
        await task.resumeAsync();
      } else {
        setActiveDownloads(prev => prev.map(d => d.id === id ? { ...d, isPaused: true, speed: 'Paused' } : d));
        await task.pauseAsync();
      }
    } catch (e) {
      console.log('Pause/Resume Error', e);
    }
  };

  const handleCancel = async (id: string) => {
    const task = downloadTasks.current[id];
    if (!task) return;
    try {
      await task.cancelAsync();
    } catch (e) {}
    delete downloadTasks.current[id];
    setActiveDownloads(prev => prev.filter(d => d.id !== id));
  };

  /** Download all items from a playlist individually */
  const handlePlaylistDownloadAll = async (opt: any) => {
    if (!opt.isPlaylist) return;

    Alert.alert(
      'Download Playlist',
      `This will download the entire playlist as ${opt.playlistFormat === 'audio' ? 'MP3 audio' : 'MP4 video'} files.\n\nThe download will be streamed through the server.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => handleStartDownload(opt),
        },
      ]
    );
  };

  // ── PERFORMANCE: Memoize platform info to avoid recomputing on every render
  const platformInfo = useMemo(() => {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) return { name: 'logo-youtube' as any, color: '#FF0000', platform: 'youtube' };
    if (urlLower.includes('instagram.com')) return { name: 'logo-instagram' as any, color: '#E1306C', platform: 'instagram' };
    if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) return { name: 'logo-facebook' as any, color: '#1877F2', platform: 'facebook' };
    if (urlLower.includes('linkedin.com')) return { name: 'logo-linkedin' as any, color: '#0077B5', platform: 'linkedin' };
    if (urlLower.includes('snapchat.com')) return { name: 'logo-snapchat' as any, color: '#E6C200', platform: 'snapchat' };
    return { name: 'link-outline' as any, color: '#00E5FF', platform: 'web' };
  }, [url]);

  const handleAnalyze = useCallback(async () => {
    if (!url) return;
    setAnalyzing(true);
    setResult(null);

    try {
      const baseUrl = getServerBaseUrl();
      const apiUrl = `${baseUrl}/api/media/analyze`;
      
      console.log('Connecting to:', apiUrl);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout — extractors complete in <20s now

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      if (data.status === 'success') {
        setResult({ ...data.data, platform: platformInfo.platform });
      } else {
        throw new Error(data.message || 'Extraction failed');
      }
      setAnalyzing(false);
    } catch (error: any) {
      setAnalyzing(false);
      if (error.name === 'AbortError') {
        Alert.alert('Timeout', 'The server took too long to respond.\n\nMake sure:\n1. Backend server is running (node server.js)\n2. Phone and PC are on the same Wi-Fi network');
      } else if (error.message?.includes('Network request failed')) {
        const baseUrl = getServerBaseUrl();
        Alert.alert(
          'Connection Failed',
          `Cannot reach backend server.\n\nTrying: ${baseUrl}\n\n✅ Make sure:\n1. Run "node server.js" on your PC\n2. Phone and PC are on same Wi-Fi\n3. PC firewall allows port ${SERVER_PORT}`
        );
      } else {
        Alert.alert('Extraction Error', error.message);
      }
    }
  }, [url, platformInfo]);

  return (
    <LinearGradient colors={isDark ? ['#000B18', '#02050D'] : ['#E3F2FD', '#FFFFFF']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: themeColors.text }]}>WELCOME BACK</Text>
          <Text style={[styles.subtitle, { color: themeColors.subText }]}>Download from your favorite platforms</Text>
          
          <View style={styles.socialHeaderRow}>
            <Ionicons name="logo-youtube" size={26} color="#FF0000" />
            <Ionicons name="logo-instagram" size={26} color="#E1306C" />
            <Ionicons name="logo-facebook" size={26} color="#1877F2" />
            <Ionicons name="logo-linkedin" size={26} color="#0077B5" />
            <Ionicons name="logo-snapchat" size={26} color="#E6C200" />
          </View>
        </View>

        <View style={[styles.inputCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
          <Ionicons name={platformInfo.name} size={24} color={platformInfo.color} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, { color: themeColors.text }]}
            placeholder="Paste Social Media Link..."
            placeholderTextColor={isDark ? '#666' : '#999'}
            value={url}
            onChangeText={setUrl}
          />
          {url.length > 0 && (
            <TouchableOpacity onPress={() => { setUrl(''); setResult(null); }}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity 
          style={[styles.mainBtn, analyzing && { opacity: 0.7 }]} 
          onPress={handleAnalyze}
          disabled={analyzing}
        >
          <LinearGradient colors={['#3B82F6', '#2563EB']} style={styles.btnGradient}>
            <Text style={styles.btnText}>{analyzing ? '⏳ ANALYZING...' : '🔍 EXTRACT MEDIA'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {result && result.options && (
          <Animated.View entering={FadeInDown} style={styles.resultContainer}>
            <View style={styles.resultPreviewHeader}>
              {result.thumbnail && (
                <Image source={{ uri: result.thumbnail }} style={styles.mainResultThumbnail} resizeMode="cover" />
              )}
              <View style={styles.resultTitleBox}>
                <Text style={[styles.resultHeader, { color: themeColors.text }]}>{result.title || 'Extracted Media'}</Text>
                <Text style={styles.platformBadge}>{result.platform?.toUpperCase()}</Text>
                {result.type === 'playlist' && (
                  <Text style={[styles.playlistBadge]}>📋 PLAYLIST</Text>
                )}
              </View>
            </View>

            {/* YouTube single video: show a single Download button → opens quality modal */}
            {result.platform === 'youtube' && result.type !== 'playlist' ? (
              <TouchableOpacity
                style={styles.ytDownloadBtn}
                onPress={() => { setSelectedDownloadTab('video'); setShowDownloadModal(true); }}
              >
                <LinearGradient colors={['#10B981', '#059669']} style={styles.ytDownloadBtnGradient}>
                  <Ionicons name="download-outline" size={22} color="#FFF" />
                  <Text style={styles.ytDownloadBtnText}>DOWNLOAD</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              /* Non-YouTube or playlist: keep existing flat option list */
              result.options.map((opt: any, index: number) => (
                <MediaOptionItem
                  key={index}
                  opt={opt}
                  index={index}
                  isDark={isDark}
                  themeColors={themeColors}
                  onDownload={handleStartDownload}
                  onPlaylistDownload={handlePlaylistDownloadAll}
                />
              ))
            )}
          </Animated.View>
        )}

        {/* ═══════ YouTube Download Quality Modal ═══════ */}
        {result && result.platform === 'youtube' && result.type !== 'playlist' && (
          <Modal
            visible={showDownloadModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowDownloadModal(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setShowDownloadModal(false)}>
              <Pressable style={[styles.modalSheet, { backgroundColor: isDark ? '#111827' : '#FFFFFF' }]} onPress={(e) => e.stopPropagation()}>
                {/* Handle bar */}
                <View style={styles.modalHandle} />

                {/* Title */}
                <Text style={[styles.modalTitle, { color: themeColors.text }]}>Download Options</Text>
                <Text style={[styles.modalSubtitle, { color: themeColors.subText }]} numberOfLines={2}>
                  {result.title || 'YouTube Media'}
                </Text>

                {/* Tab Selector: Video / MP3 */}
                <View style={[styles.modalTabRow, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
                  <TouchableOpacity
                    style={[styles.modalTab, selectedDownloadTab === 'video' && styles.modalTabActive]}
                    onPress={() => setSelectedDownloadTab('video')}
                  >
                    <Ionicons name="videocam" size={18} color={selectedDownloadTab === 'video' ? '#FFF' : (isDark ? '#9CA3AF' : '#6B7280')} />
                    <Text style={[styles.modalTabText, selectedDownloadTab === 'video' && styles.modalTabTextActive]}>
                      Video
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalTab, selectedDownloadTab === 'audio' && styles.modalTabActiveAudio]}
                    onPress={() => setSelectedDownloadTab('audio')}
                  >
                    <Ionicons name="musical-notes" size={18} color={selectedDownloadTab === 'audio' ? '#FFF' : (isDark ? '#9CA3AF' : '#6B7280')} />
                    <Text style={[styles.modalTabText, selectedDownloadTab === 'audio' && styles.modalTabTextActive]}>
                      MP3
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Quality Options List */}
                <ScrollView style={styles.modalOptionsList} showsVerticalScrollIndicator={false}>
                  {result.options
                    .filter((opt: any) => {
                      if (selectedDownloadTab === 'audio') {
                        return opt.isAudio || opt.format === 'MP3' || opt.format === 'M4A';
                      }
                      return !opt.isAudio && opt.format !== 'MP3' && opt.format !== 'M4A' && !opt.isPlaylist;
                    })
                    .map((opt: any, index: number) => {
                      const isAudio = opt.isAudio || opt.format === 'MP3' || opt.format === 'M4A';
                      return (
                        <TouchableOpacity
                          key={index}
                          style={[styles.modalOption, { backgroundColor: isDark ? '#1F2937' : '#F9FAFB', borderColor: isDark ? '#374151' : '#E5E7EB' }]}
                          onPress={() => {
                            setShowDownloadModal(false);
                            handleStartDownload(opt, isAudio ? undefined : 'video');
                          }}
                        >
                          <View style={styles.modalOptionInfo}>
                            <View style={styles.modalOptionRow}>
                              <Ionicons
                                name={isAudio ? 'musical-note' : 'film-outline'}
                                size={20}
                                color={isAudio ? '#8B5CF6' : '#10B981'}
                              />
                              <Text style={[styles.modalOptionQuality, { color: themeColors.text }]}>
                                {opt.quality}
                              </Text>
                            </View>
                            <View style={styles.modalOptionMeta}>
                              <Text style={styles.modalOptionFormat}>{opt.format}</Text>
                              {opt.size && opt.size !== 'Auto' && (
                                <Text style={styles.modalOptionSize}>{opt.size}</Text>
                              )}
                              {opt.note ? <Text style={styles.modalOptionNote}>{opt.note}</Text> : null}
                            </View>
                          </View>
                          <View style={[styles.modalDownloadIcon, { backgroundColor: isAudio ? '#8B5CF6' : '#10B981' }]}>
                            <Ionicons name="download-outline" size={18} color="#FFF" />
                          </View>
                        </TouchableOpacity>
                      );
                    })}

                  {/* Empty state */}
                  {result.options.filter((opt: any) => {
                    if (selectedDownloadTab === 'audio') return opt.isAudio || opt.format === 'MP3' || opt.format === 'M4A';
                    return !opt.isAudio && opt.format !== 'MP3' && opt.format !== 'M4A' && !opt.isPlaylist;
                  }).length === 0 && (
                    <View style={styles.modalEmpty}>
                      <Ionicons name="alert-circle-outline" size={40} color={themeColors.subText} />
                      <Text style={[styles.modalEmptyText, { color: themeColors.subText }]}>
                        No {selectedDownloadTab === 'audio' ? 'audio' : 'video'} options available
                      </Text>
                    </View>
                  )}
                </ScrollView>

                {/* Cancel button */}
                <TouchableOpacity
                  style={[styles.modalCancelBtn, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}
                  onPress={() => setShowDownloadModal(false)}
                >
                  <Text style={[styles.modalCancelText, { color: themeColors.subText }]}>Cancel</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        )}

        {activeDownloads.length > 0 && (
          <View style={styles.progressSection}>
            <Text style={[styles.sectionLabel, { color: themeColors.text }]}>ACTIVE DOWNLOADS</Text>
            {activeDownloads.map((d) => (
              <View key={d.id} style={styles.progressCard}>
                <View style={styles.progressHeader}>
                  <Text style={[styles.progressTitle, { color: themeColors.text }]} numberOfLines={1}>{d.title}</Text>
                  <Text style={styles.progressPercent}>{d.progress >= 0 ? `${d.progress}%` : '...'}</Text>
                </View>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: d.progress >= 0 ? `${d.progress}%` : '50%' }]} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <Text style={styles.progressSpeed}>{d.speed}</Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity onPress={() => handlePauseResume(d.id, d.isPaused)} style={styles.controlBtn}>
                      <Ionicons name={d.isPaused ? "play" : "pause"} size={18} color={themeColors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleCancel(d.id)} style={styles.controlBtn}>
                      <Ionicons name="close" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingTop: 60, paddingBottom: 100 },
  header: { alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  subtitle: { fontSize: 13, letterSpacing: 1, marginTop: 4, marginBottom: 15 },
  socialHeaderRow: {
     flexDirection: 'row',
     gap: 18,
     marginTop: 10,
     opacity: 0.85,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 15 },
  mainBtn: { borderRadius: 16, overflow: 'hidden', height: 56, marginBottom: 30 },
  btnGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  resultPreviewHeader: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  mainResultThumbnail: {
    width: 100,
    height: 100,
  },
  resultTitleBox: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  platformBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#3B82F6',
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
  },
  playlistBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  resultContainer: {
    borderRadius: 24,
    padding: 4,
    marginBottom: 20,
  },
  resultHeader: { fontSize: 16, fontWeight: '700' },
  mediaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    marginBottom: 12,
  },
  mediaPreview: { width: 50, height: 50, borderRadius: 10, marginRight: 12 },
  mediaInfo: { flex: 1 },
  mediaQuality: { fontSize: 13, fontWeight: '600' },
  mediaMeta: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  noteText: { fontSize: 10, color: '#F59E0B', marginTop: 2 },
  mediaActions: { flexDirection: 'row', gap: 8 },
  dualBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  dualBtnText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  // ─── YouTube Download Button ───
  ytDownloadBtn: { borderRadius: 16, overflow: 'hidden', height: 56, marginTop: 8 },
  ytDownloadBtnGradient: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  ytDownloadBtnText: { color: '#FFF', fontWeight: '800', fontSize: 16, letterSpacing: 1.5 },

  // ─── Download Modal ───
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.4)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  modalSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  modalTabRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  modalTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 11,
    gap: 6,
  },
  modalTabActive: {
    backgroundColor: '#10B981',
  },
  modalTabActiveAudio: {
    backgroundColor: '#8B5CF6',
  },
  modalTabText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  modalTabTextActive: {
    color: '#FFFFFF',
  },
  modalOptionsList: {
    maxHeight: 340,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  modalOptionInfo: {
    flex: 1,
  },
  modalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalOptionQuality: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  modalOptionMeta: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginLeft: 28,
  },
  modalOptionFormat: {
    fontSize: 11,
    color: '#3B82F6',
    fontWeight: '700',
    backgroundColor: 'rgba(59,130,246,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  modalOptionSize: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  modalOptionNote: {
    fontSize: 10,
    color: '#F59E0B',
    fontWeight: '600',
  },
  modalDownloadIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  modalEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  modalEmptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalCancelBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },

  progressSection: { marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 15, opacity: 0.6 },
  progressCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  progressPercent: { color: '#3B82F6', fontSize: 13, fontWeight: '800' },
  progressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 3 },
  progressSpeed: { fontSize: 11, color: '#8FA1B3' },
  controlBtn: { padding: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 },
});
