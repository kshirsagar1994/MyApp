import { Platform } from 'react-native';
import mobileAds, {
  InterstitialAd,
  RewardedAd,
  AdEventType,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

// Ad Unit IDs
export const AD_UNIT_IDS = {
  APP_ID: 'ca-app-pub-7506421101876458~8932553901',
  INTERSTITIAL: __DEV__ ? TestIds.INTERSTITIAL : 'ca-app-pub-7506421101876458/7911116272',
  REWARDED: __DEV__ ? TestIds.REWARDED : 'ca-app-pub-7506421101876458/5284952936',
  BANNER: __DEV__ ? TestIds.BANNER : TestIds.BANNER,
};

// ==================== REWARDED AD MANAGEMENT ====================
let rewardedAdInstance: RewardedAd | null = null;
let isRewardedAdLoaded = false;
let isLoadingRewardedAd = false;
let rewardedAdUnsubscribeFunctions: (() => void)[] = [];

function cleanupRewardedListeners() {
  rewardedAdUnsubscribeFunctions.forEach(unsubscribe => {
    try { unsubscribe(); } catch {}
  });
  rewardedAdUnsubscribeFunctions = [];
}

/**
 * Preload a rewarded ad into memory
 */
export function preloadRewardedAd() {
  if (Platform.OS === 'web') return;
  if (isLoadingRewardedAd || isRewardedAdLoaded) return;

  isLoadingRewardedAd = true;
  cleanupRewardedListeners();

  try {
    rewardedAdInstance = RewardedAd.createForAdRequest(AD_UNIT_IDS.REWARDED, {
      requestNonPersonalizedAdsOnly: false,
    });

    const unsubscribeLoaded = rewardedAdInstance.addAdEventListener(RewardedAdEventType.LOADED, () => {
      isRewardedAdLoaded = true;
      isLoadingRewardedAd = false;
      console.log('[AdMob] Rewarded Ad successfully loaded and ready.');
    });

    const unsubscribeError = rewardedAdInstance.addAdEventListener(AdEventType.ERROR, (error) => {
      isRewardedAdLoaded = false;
      isLoadingRewardedAd = false;
      console.warn('[AdMob] Rewarded Ad load error:', error);
    });

    rewardedAdUnsubscribeFunctions.push(unsubscribeLoaded, unsubscribeError);
    rewardedAdInstance.load();
  } catch (err) {
    isLoadingRewardedAd = false;
    isRewardedAdLoaded = false;
    console.warn('[AdMob] Failed to create Rewarded Ad:', err);
  }
}

/**
 * Show a rewarded ad before executing the download action.
 * If the ad is ready, it displays the ad and proceeds with download on completion/reward.
 * If the ad is not ready, it proceeds directly to the download so the user is never blocked.
 */
export async function showRewardedAdForDownload(onProceed: () => void) {
  if (Platform.OS === 'web' || !rewardedAdInstance || !isRewardedAdLoaded) {
    // Ad not ready or on web -> proceed immediately and preload for next time
    onProceed();
    preloadRewardedAd();
    return;
  }

  let hasProceeded = false;
  const proceedOnce = () => {
    if (!hasProceeded) {
      hasProceeded = true;
      onProceed();
      isRewardedAdLoaded = false;
      preloadRewardedAd();
    }
  };

  try {
    cleanupRewardedListeners();

    const unsubscribeEarned = rewardedAdInstance.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        proceedOnce();
      }
    );

    const unsubscribeClosed = rewardedAdInstance.addAdEventListener(AdEventType.CLOSED, () => {
      proceedOnce();
    });

    const unsubscribeError = rewardedAdInstance.addAdEventListener(AdEventType.ERROR, (err) => {
      console.warn('[AdMob] Rewarded Ad display error:', err);
      proceedOnce();
    });

    rewardedAdUnsubscribeFunctions.push(unsubscribeEarned, unsubscribeClosed, unsubscribeError);
    await rewardedAdInstance.show();
  } catch (e) {
    console.warn('[AdMob] Error displaying Rewarded Ad:', e);
    proceedOnce();
  }
}

// ==================== INTERSTITIAL AD MANAGEMENT ====================
let interstitialAdInstance: InterstitialAd | null = null;
let isInterstitialAdLoaded = false;
let isLoadingInterstitialAd = false;
let interstitialAdUnsubscribeFunctions: (() => void)[] = [];

function cleanupInterstitialListeners() {
  interstitialAdUnsubscribeFunctions.forEach(unsubscribe => {
    try { unsubscribe(); } catch {}
  });
  interstitialAdUnsubscribeFunctions = [];
}

/**
 * Preload an interstitial ad into memory
 */
export function preloadInterstitialAd() {
  if (Platform.OS === 'web') return;
  if (isLoadingInterstitialAd || isInterstitialAdLoaded) return;

  isLoadingInterstitialAd = true;
  cleanupInterstitialListeners();

  try {
    interstitialAdInstance = InterstitialAd.createForAdRequest(AD_UNIT_IDS.INTERSTITIAL, {
      requestNonPersonalizedAdsOnly: false,
    });

    const unsubscribeLoaded = interstitialAdInstance.addAdEventListener(AdEventType.LOADED, () => {
      isInterstitialAdLoaded = true;
      isLoadingInterstitialAd = false;
      console.log('[AdMob] Interstitial Ad successfully loaded and ready.');
    });

    const unsubscribeError = interstitialAdInstance.addAdEventListener(AdEventType.ERROR, (error) => {
      isInterstitialAdLoaded = false;
      isLoadingInterstitialAd = false;
      console.warn('[AdMob] Interstitial Ad load error:', error);
    });

    interstitialAdUnsubscribeFunctions.push(unsubscribeLoaded, unsubscribeError);
    interstitialAdInstance.load();
  } catch (err) {
    isLoadingInterstitialAd = false;
    isInterstitialAdLoaded = false;
    console.warn('[AdMob] Failed to create Interstitial Ad:', err);
  }
}

/**
 * Show an Interstitial Ad when user clicks to Extract Media.
 * If the ad is ready, displays the ad and proceeds with extraction when closed.
 * If the ad is not ready, proceeds with extraction immediately without blocking the user.
 */
export async function showInterstitialAdForExtract(onProceed: () => void) {
  if (Platform.OS === 'web' || !interstitialAdInstance || !isInterstitialAdLoaded) {
    // Ad not ready or on web -> proceed immediately with extraction and preload next ad
    onProceed();
    preloadInterstitialAd();
    return;
  }

  let hasProceeded = false;
  const proceedOnce = () => {
    if (!hasProceeded) {
      hasProceeded = true;
      onProceed();
      isInterstitialAdLoaded = false;
      preloadInterstitialAd();
    }
  };

  try {
    cleanupInterstitialListeners();

    const unsubscribeClosed = interstitialAdInstance.addAdEventListener(AdEventType.CLOSED, () => {
      proceedOnce();
    });

    const unsubscribeError = interstitialAdInstance.addAdEventListener(AdEventType.ERROR, (err) => {
      console.warn('[AdMob] Interstitial Ad display error:', err);
      proceedOnce();
    });

    interstitialAdUnsubscribeFunctions.push(unsubscribeClosed, unsubscribeError);
    await interstitialAdInstance.show();
  } catch (e) {
    console.warn('[AdMob] Error displaying Interstitial Ad:', e);
    proceedOnce();
  }
}

// ==================== INITIALIZATION ====================
/**
 * Initialize Google Mobile Ads SDK and start preloading both Rewarded and Interstitial ads
 */
export async function initializeAdMob() {
  if (Platform.OS === 'web') return;
  try {
    const status = await mobileAds().initialize();
    console.log('[AdMob] Initialized successfully');
    preloadRewardedAd();
    preloadInterstitialAd();
    return status;
  } catch (error) {
    console.warn('[AdMob] Failed to initialize Google Mobile Ads:', error);
  }
}
