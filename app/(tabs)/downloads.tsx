import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, ScrollView, TouchableOpacity, Alert, Modal, Image, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { Video, ResizeMode } from 'expo-av';

const CATEGORIES = ['All', 'Videos', 'Music', 'Images'];

const ITEM_HEIGHT = 76;

const DownloadItem = React.memo(({ item, themeColors, isDark, onPlay, onShare, onDelete }: {
  item: any;
  themeColors: any;
  isDark: boolean;
  onPlay: (uri: string, type?: string) => void;
  onShare: (uri: string) => void;
  onDelete: (id: string) => void;
}) => (
  <View style={[styles.downloadCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
    <View style={[styles.iconWrapper, { backgroundColor: isDark ? '#333' : '#eee' }]}>
      <Ionicons
        name={item.type === 'video' ? 'videocam' : item.type === 'music' ? 'musical-notes' : 'image'}
        size={24}
        color={themeColors.text}
      />
    </View>
    <View style={styles.infoWrapper}>
      <Text style={[styles.itemTitle, { color: themeColors.text }]} numberOfLines={1}>{item.title}</Text>
      <Text style={[styles.itemSize, { color: themeColors.subText }]}>{item.size}</Text>
    </View>
    <View style={styles.actionsWrapper}>
      <TouchableOpacity style={styles.actionBtn} onPress={() => onPlay(item.uri, item.type)}>
        <Ionicons name="play" size={22} color={themeColors.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={() => onShare(item.uri)}>
        <Ionicons name="share-social" size={22} color={themeColors.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={() => onDelete(item.id)}>
        <Ionicons name="trash" size={22} color="#FF3B30" />
      </TouchableOpacity>
    </View>
  </View>
));

export default function DownloadsScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const themeColors = useMemo(() => ({
    bg: isDark ? '#050B14' : '#f5f5f5',
    card: isDark ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
    text: isDark ? '#ffffff' : '#333333',
    subText: isDark ? '#8FA1B3' : '#666666',
    border: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e0e0e0',
    primary: isDark ? '#00E5FF' : '#007AFF',
  }), [isDark]);

  const [downloads, setDownloads] = useState<any[]>([]);
  const [playingMedia, setPlayingMedia] = useState<{uri: string, type: string} | null>(null);

  useFocusEffect(
    useCallback(() => {
      const fetchDownloads = async () => {
        try {
          const stored = await AsyncStorage.getItem('downloads');
          if (stored) {
            setDownloads(JSON.parse(stored));
          } else {
            setDownloads([]);
          }
        } catch (error) {
          // Silent fail — empty state shown
        }
      };
      fetchDownloads();
    }, [])
  );

  const handleDelete = useCallback((id: string) => {
    Alert.alert('Delete File', 'Are you sure you want to delete this file?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
         const newDownloads = downloads.filter(d => d.id !== id);
         setDownloads(newDownloads);
         await AsyncStorage.setItem('downloads', JSON.stringify(newDownloads));
      }}
    ]);
  }, [downloads]);

  const handleClearAll = useCallback(() => {
    Alert.alert('Clear All', 'Are you sure you want to delete all completed files?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: async () => {
         setDownloads([]);
         await AsyncStorage.setItem('downloads', '[]');
      }}
    ]);
  }, []);

  const handlePlay = useCallback((uri: string, type?: string) => {
    if (!uri) {
      Alert.alert('Error', 'File not found on device.');
      return;
    }
    setPlayingMedia({ uri, type: type || 'unknown' });
  }, []);

  const handleShare = useCallback(async (uri: string) => {
    if (!uri) {
      Alert.alert('Error', 'File not found on device.');
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Unavailable', 'Sharing is not available on this device');
      }
    } catch (e) {
      // Silent fail
    }
  }, []);

  const handleCloseModal = useCallback(() => setPlayingMedia(null), []);

  const filteredDownloads = useMemo(() => {
    return downloads.filter(item => {
      const matchesCategory = activeCategory === 'All' || item.type?.toLowerCase() === activeCategory.replace(/s$/, '').toLowerCase() || (activeCategory === 'Videos' && item.type === 'video');
      const matchesSearch = !search || item.title?.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [downloads, activeCategory, search]);

  const keyExtractor = useCallback((item: any) => item.id, []);
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  }), []);

  const renderItem = useCallback(({ item }: { item: any }) => (
    <DownloadItem
      item={item}
      themeColors={themeColors}
      isDark={isDark}
      onPlay={handlePlay}
      onShare={handleShare}
      onDelete={handleDelete}
    />
  ), [themeColors, isDark, handlePlay, handleShare, handleDelete]);

  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="cloud-download-outline" size={64} color={themeColors.subText} />
      <Text style={[styles.emptyTitle, { color: themeColors.subText }]}>
        {search ? 'No matching downloads' : 'No downloads yet'}
      </Text>
      <Text style={[styles.emptySubtitle, { color: themeColors.subText }]}>
        {search ? 'Try a different search term' : 'Download media from the Home tab'}
      </Text>
    </View>
  ), [search, themeColors.subText]);

  // Use ScrollView for categories (NOT FlatList) to avoid nested VirtualizedList crash
  const ListHeaderComponent = useMemo(() => (
    <>
      <View style={[styles.searchContainer, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
        <Ionicons name="search" size={20} color={themeColors.subText} style={styles.icon} />
        <TextInput
          style={[styles.searchInput, { color: themeColors.text }]}
          placeholder="Search downloads..."
          placeholderTextColor={themeColors.subText}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.categoryBadge,
              activeCategory === cat ? { backgroundColor: themeColors.primary } : { backgroundColor: themeColors.card, borderColor: themeColors.border }
            ]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={{
              color: activeCategory === cat ? '#fff' : themeColors.text,
              fontWeight: '600'
            }}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Completed</Text>
        {downloads.length > 0 && (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={[styles.clearAllText, { color: themeColors.primary }]}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  ), [themeColors, activeCategory, search, downloads.length, handleClearAll]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <FlatList
        data={filteredDownloads}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        removeClippedSubviews={true}
        maxToRenderPerBatch={15}
        windowSize={7}
        initialNumToRender={10}
        contentContainerStyle={styles.listContent}
      />

      <Modal visible={!!playingMedia} transparent={false} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={handleCloseModal}>
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            {playingMedia?.type === 'image' ? (
              <Image source={{ uri: playingMedia.uri }} style={styles.modalMedia} resizeMode="contain" />
            ) : playingMedia?.type === 'video' || playingMedia?.type === 'music' ? (
              <Video
                source={{ uri: playingMedia.uri }}
                style={styles.modalMedia}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
              />
            ) : (
              <Text style={styles.unsupportedText}>Unsupported media type</Text>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
    marginBottom: 16,
  },
  icon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16 },
  categoryScroll: {
    flexDirection: 'row',
    marginBottom: 20,
    maxHeight: 50,
  },
  categoryBadge: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold' },
  clearAllText: { fontSize: 14, fontWeight: '600' },
  downloadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoWrapper: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  itemSize: { fontSize: 13 },
  actionsWrapper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBtn: { padding: 4 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, marginTop: 16, fontWeight: '600' },
  emptySubtitle: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  modalContainer: { flex: 1, backgroundColor: '#000' },
  modalHeader: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16 },
  modalContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalMedia: { width: '100%', height: '100%' },
  unsupportedText: { color: '#fff' },
});
