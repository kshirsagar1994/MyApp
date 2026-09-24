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

let rewardedAdInstance: RewardedAd | null = null;
let isRewardedAdLoaded = false;
let isLoadingRewardedAd = false;
let rewardedAdUnsubscribeFunctions: (() => void)[] = [];

/**
 * Clean up existing rewarded ad listeners
 */
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
    });

    const unsubscribeError = rewardedAdInstance.addAdEventListener(AdEventType.ERROR, (error) => {
      isRewardedAdLoaded = false;
      isLoadingRewardedAd = false;
      console.warn('AdMob Rewarded Ad load error:', error);
    });

    rewardedAdUnsubscribeFunctions.push(unsubscribeLoaded, unsubscribeError);
    rewardedAdInstance.load();
  } catch (err) {
    isLoadingRewardedAd = false;
    isRewardedAdLoaded = false;
    console.warn('Failed to create Rewarded Ad:', err);
  }
}

/**
 * Show a rewarded ad before executing the download action.
 * If the ad is ready, it shows the ad and runs `onProceed` upon completion.
 * If the ad is not ready, it proceeds directly to the download so the user is never blocked.
 */
export async function showRewardedAdForDownload(onProceed: () => void) {
  if (Platform.OS === 'web' || !rewardedAdInstance || !isRewardedAdLoaded) {
    // If ad is not ready yet, proceed with download and start preloading next ad
    onProceed();
    preloadRewardedAd();
    return;
  }

  let hasProceeded = false;
  const proceedOnce = () => {
    if (!hasProceeded) {
      hasProceeded = true;
      onProceed();
      // Preload next rewarded ad for future downloads
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

    const unsubscribeError = rewardedAdInstance.addAdEventListener(AdEventType.ERROR, () => {
      proceedOnce();
    });

    rewardedAdUnsubscribeFunctions.push(unsubscribeEarned, unsubscribeClosed, unsubscribeError);
    await rewardedAdInstance.show();
  } catch (e) {
    console.warn('Error displaying Rewarded Ad:', e);
    proceedOnce();
  }
}

/**
 * Initialize Google Mobile Ads SDK and start preloading ads
 */
export async function initializeAdMob() {
  if (Platform.OS === 'web') return;
  try {
    const status = await mobileAds().initialize();
    preloadRewardedAd();
    return status;
  } catch (error) {
    console.warn('Failed to initialize Google Mobile Ads:', error);
  }
}

/**
 * Helper to create and load an Interstitial Ad
 */
export function createInterstitialAd(onClosed?: () => void) {
  if (Platform.OS === 'web') {
    return { show: () => { if (onClosed) onClosed(); }, cleanup: () => {} };
  }

  const interstitial = InterstitialAd.createForAdRequest(AD_UNIT_IDS.INTERSTITIAL, {
    requestNonPersonalizedAdsOnly: false,
  });

  const unsubscribeLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {});

  const unsubscribeClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    if (onClosed) onClosed();
  });

  interstitial.load();

  return {
    show: () => {
      if (interstitial.loaded) {
        interstitial.show();
      } else {
        if (onClosed) onClosed();
      }
    },
    cleanup: () => {
      unsubscribeLoaded();
      unsubscribeClosed();
    },
  };
}
