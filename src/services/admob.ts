import { Platform } from "react-native";
import mobileAds, {
  AdEventType,
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

// ======================================================
// ADMOB IDs
// ======================================================

export const AD_UNIT_IDS = {
  APP_ID: "ca-app-pub-7506421101876458~8932553901",

  INTERSTITIAL: __DEV__
    ? TestIds.INTERSTITIAL
    : "ca-app-pub-7506421101876458/7911116272",

  REWARDED: __DEV__
    ? TestIds.REWARDED
    : "ca-app-pub-7506421101876458/5284952936",

  BANNER: __DEV__ ? TestIds.BANNER : "ca-app-pub-7506421101876458/XXXXXXXXXX",
};

// ======================================================
// STATE
// ======================================================

let rewardedAd: RewardedAd | null = null;
let rewardedLoaded = false;
let rewardedLoading = false;

let interstitialAd: InterstitialAd | null = null;
let interstitialLoaded = false;
let interstitialLoading = false;

let isInitialized = false;

// ======================================================
// REWARDED AD
// ======================================================

export function preloadRewardedAd() {
  if (Platform.OS === "web") return;

  if (rewardedLoading || rewardedLoaded) {
    return;
  }

  rewardedLoading = true;

  try {
    rewardedAd = RewardedAd.createForAdRequest(AD_UNIT_IDS.REWARDED, {
      requestNonPersonalizedAdsOnly: false,
    });

    rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedLoaded = true;
      rewardedLoading = false;

      console.log("[AdMob] Rewarded ad loaded");
    });

    rewardedAd.addAdEventListener(AdEventType.ERROR, (error) => {
      rewardedLoaded = false;
      rewardedLoading = false;

      console.warn("[AdMob] Rewarded load error:", error);
    });

    rewardedAd.load();
  } catch (error) {
    rewardedLoaded = false;
    rewardedLoading = false;

    console.warn("[AdMob] Rewarded creation error:", error);
  }
}

// ======================================================
// SHOW REWARDED AD
// ======================================================

export async function showRewardedAdForDownload(onProceed: () => void) {
  if (Platform.OS === "web" || !rewardedAd || !rewardedLoaded) {
    console.log("[AdMob] Rewarded ad not ready");

    onProceed();

    preloadRewardedAd();

    return;
  }

  const ad = rewardedAd;

  // Prevent same ad from being shown twice
  rewardedAd = null;
  rewardedLoaded = false;

  let rewardEarned = false;
  let completed = false;

  const proceedOnce = () => {
    if (completed) return;

    completed = true;

    if (rewardEarned) {
      console.log("[AdMob] Reward earned - proceeding");

      onProceed();
    } else {
      console.log("[AdMob] Ad closed without reward");

      // Choose your desired behavior here.
      // Currently proceeding anyway:
      onProceed();
    }

    preloadRewardedAd();
  };

  const unsubscribeReward = ad.addAdEventListener(
    RewardedAdEventType.EARNED_REWARD,
    (reward) => {
      rewardEarned = true;

      console.log("[AdMob] Reward earned:", reward);
    },
  );

  const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
    console.log("[AdMob] Rewarded ad closed");

    unsubscribeReward();
    unsubscribeClosed();
    unsubscribeError();

    proceedOnce();
  });

  const unsubscribeError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
    console.warn("[AdMob] Rewarded show error:", error);

    unsubscribeReward();
    unsubscribeClosed();
    unsubscribeError();

    onProceed();
    preloadRewardedAd();
  });

  try {
    console.log("[AdMob] Showing rewarded ad");

    await ad.show();
  } catch (error) {
    console.warn("[AdMob] Rewarded show exception:", error);

    unsubscribeReward();
    unsubscribeClosed();
    unsubscribeError();

    onProceed();

    preloadRewardedAd();
  }
}

// ======================================================
// INTERSTITIAL AD
// ======================================================

export function preloadInterstitialAd() {
  if (Platform.OS === "web") return;

  if (interstitialLoading || interstitialLoaded) {
    return;
  }

  interstitialLoading = true;

  try {
    interstitialAd = InterstitialAd.createForAdRequest(
      AD_UNIT_IDS.INTERSTITIAL,
      {
        requestNonPersonalizedAdsOnly: false,
      },
    );

    interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
      interstitialLoaded = true;
      interstitialLoading = false;

      console.log("[AdMob] Interstitial ad loaded");
    });

    interstitialAd.addAdEventListener(AdEventType.ERROR, (error) => {
      interstitialLoaded = false;
      interstitialLoading = false;

      console.warn("[AdMob] Interstitial load error:", error);
    });

    interstitialAd.load();
  } catch (error) {
    interstitialLoaded = false;
    interstitialLoading = false;

    console.warn("[AdMob] Interstitial creation error:", error);
  }
}

// ======================================================
// SHOW INTERSTITIAL
// ======================================================

export async function showInterstitialAdForExtract(onProceed: () => void) {
  if (Platform.OS === "web" || !interstitialAd || !interstitialLoaded) {
    console.log("[AdMob] Interstitial not ready");

    onProceed();

    preloadInterstitialAd();

    return;
  }

  const ad = interstitialAd;

  interstitialAd = null;
  interstitialLoaded = false;

  let completed = false;

  const proceedOnce = () => {
    if (completed) return;

    completed = true;

    onProceed();

    preloadInterstitialAd();
  };

  const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
    console.log("[AdMob] Interstitial closed");

    unsubscribeClosed();
    unsubscribeError();

    proceedOnce();
  });

  const unsubscribeError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
    console.warn("[AdMob] Interstitial show error:", error);

    unsubscribeClosed();
    unsubscribeError();

    proceedOnce();
  });

  try {
    console.log("[AdMob] Showing interstitial");

    await ad.show();
  } catch (error) {
    console.warn("[AdMob] Interstitial show exception:", error);

    unsubscribeClosed();
    unsubscribeError();

    proceedOnce();
  }
}

// ======================================================
// INITIALIZATION
// ======================================================

export async function initializeAdMob() {
  if (Platform.OS === "web") {
    return;
  }

  if (isInitialized) {
    console.log("[AdMob] Already initialized");

    return;
  }

  try {
    const status = await mobileAds().initialize();

    isInitialized = true;

    console.log("[AdMob] SDK initialized successfully", status);

    preloadRewardedAd();
    preloadInterstitialAd();

    return status;
  } catch (error) {
    console.warn("[AdMob] SDK initialization failed:", error);
  }
}
