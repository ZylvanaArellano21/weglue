import type { ImageSourcePropType } from "react-native";
import type { PresetAvatarId } from "@weglue/shared";

// Metro must be able to statically see every asset.  Keep this mapping in the
// mobile boundary while the ID/name contract stays in packages/shared.
const presetAvatarAssets: Record<PresetAvatarId, ImageSourcePropType> = {
  avatar_01: require("../../../packages/shared/assets/preset-avatars/png/avatar_01_green_hoodie.png"),
  avatar_02: require("../../../packages/shared/assets/preset-avatars/png/avatar_02_black_hair_star_earrings.png"),
  avatar_03: require("../../../packages/shared/assets/preset-avatars/png/avatar_03_purple_hoodie_curls.png"),
  avatar_04: require("../../../packages/shared/assets/preset-avatars/png/avatar_04_blue_cap_blonde.png"),
  avatar_05: require("../../../packages/shared/assets/preset-avatars/png/avatar_05_glasses_cream_hoodie.png"),
  avatar_06: require("../../../packages/shared/assets/preset-avatars/png/avatar_06_space_buns_peace.png"),
  avatar_07: require("../../../packages/shared/assets/preset-avatars/png/avatar_07_braids_gold_earrings.png"),
  avatar_08: require("../../../packages/shared/assets/preset-avatars/png/avatar_08_beanie_headphones.png"),
  avatar_09: require("../../../packages/shared/assets/preset-avatars/png/avatar_09_pink_hair.png"),
  avatar_10: require("../../../packages/shared/assets/preset-avatars/png/avatar_10_blonde_blue_hoodie.png"),
  avatar_11: require("../../../packages/shared/assets/preset-avatars/png/avatar_11_dinosaur_hood.png"),
  avatar_12: require("../../../packages/shared/assets/preset-avatars/png/avatar_12_yellow_beanie.png"),
  avatar_13: require("../../../packages/shared/assets/preset-avatars/png/avatar_13_astronaut.png"),
  avatar_14: require("../../../packages/shared/assets/preset-avatars/png/avatar_14_gray_cat_scarf.png"),
  avatar_15: require("../../../packages/shared/assets/preset-avatars/png/avatar_15_panda_hoodie.png"),
  avatar_16: require("../../../packages/shared/assets/preset-avatars/png/avatar_16_husky_hoodie.png"),
  avatar_17: require("../../../packages/shared/assets/preset-avatars/png/avatar_17_sporty_headband.png"),
  avatar_18: require("../../../packages/shared/assets/preset-avatars/png/avatar_18_bucket_hat_pink_glasses.png"),
  avatar_19: require("../../../packages/shared/assets/preset-avatars/png/avatar_19_red_curls.png"),
  avatar_20: require("../../../packages/shared/assets/preset-avatars/png/avatar_20_pink_cat_headphones.png"),
  avatar_21: require("../../../packages/shared/assets/preset-avatars/png/avatar_21_green_dragon.png"),
  avatar_22: require("../../../packages/shared/assets/preset-avatars/png/avatar_22_teddy_propeller_hat.png"),
  avatar_23: require("../../../packages/shared/assets/preset-avatars/png/avatar_23_dog_sunglasses.png"),
  avatar_24: require("../../../packages/shared/assets/preset-avatars/png/avatar_24_cat_astronaut.png"),
  avatar_25: require("../../../packages/shared/assets/preset-avatars/png/avatar_25_retro_robot.png"),
  avatar_26: require("../../../packages/shared/assets/preset-avatars/png/avatar_26_mushroom.png"),
  avatar_27: require("../../../packages/shared/assets/preset-avatars/png/avatar_27_vampire.png"),
  avatar_28: require("../../../packages/shared/assets/preset-avatars/png/avatar_28_pirate_parrot.png"),
  avatar_29: require("../../../packages/shared/assets/preset-avatars/png/avatar_29_friendly_alien.png"),
  avatar_30: require("../../../packages/shared/assets/preset-avatars/png/avatar_30_disco_frog.png"),
};

export function getPresetAvatarAsset(id: PresetAvatarId): ImageSourcePropType {
  return presetAvatarAssets[id];
}
