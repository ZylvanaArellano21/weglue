import type { StaticImageData } from "next/image";
import type { PresetAvatarId } from "@weglue/shared";
import avatar01 from "../../../packages/shared/assets/preset-avatars/webp/avatar_01_green_hoodie.webp";
import avatar02 from "../../../packages/shared/assets/preset-avatars/webp/avatar_02_black_hair_star_earrings.webp";
import avatar03 from "../../../packages/shared/assets/preset-avatars/webp/avatar_03_purple_hoodie_curls.webp";
import avatar04 from "../../../packages/shared/assets/preset-avatars/webp/avatar_04_blue_cap_blonde.webp";
import avatar05 from "../../../packages/shared/assets/preset-avatars/webp/avatar_05_glasses_cream_hoodie.webp";
import avatar06 from "../../../packages/shared/assets/preset-avatars/webp/avatar_06_space_buns_peace.webp";
import avatar07 from "../../../packages/shared/assets/preset-avatars/webp/avatar_07_braids_gold_earrings.webp";
import avatar08 from "../../../packages/shared/assets/preset-avatars/webp/avatar_08_beanie_headphones.webp";
import avatar09 from "../../../packages/shared/assets/preset-avatars/webp/avatar_09_pink_hair.webp";
import avatar10 from "../../../packages/shared/assets/preset-avatars/webp/avatar_10_blonde_blue_hoodie.webp";
import avatar11 from "../../../packages/shared/assets/preset-avatars/webp/avatar_11_dinosaur_hood.webp";
import avatar12 from "../../../packages/shared/assets/preset-avatars/webp/avatar_12_yellow_beanie.webp";
import avatar13 from "../../../packages/shared/assets/preset-avatars/webp/avatar_13_astronaut.webp";
import avatar14 from "../../../packages/shared/assets/preset-avatars/webp/avatar_14_gray_cat_scarf.webp";
import avatar15 from "../../../packages/shared/assets/preset-avatars/webp/avatar_15_panda_hoodie.webp";
import avatar16 from "../../../packages/shared/assets/preset-avatars/webp/avatar_16_husky_hoodie.webp";
import avatar17 from "../../../packages/shared/assets/preset-avatars/webp/avatar_17_sporty_headband.webp";
import avatar18 from "../../../packages/shared/assets/preset-avatars/webp/avatar_18_bucket_hat_pink_glasses.webp";
import avatar19 from "../../../packages/shared/assets/preset-avatars/webp/avatar_19_red_curls.webp";
import avatar20 from "../../../packages/shared/assets/preset-avatars/webp/avatar_20_pink_cat_headphones.webp";
import avatar21 from "../../../packages/shared/assets/preset-avatars/webp/avatar_21_green_dragon.webp";
import avatar22 from "../../../packages/shared/assets/preset-avatars/webp/avatar_22_teddy_propeller_hat.webp";
import avatar23 from "../../../packages/shared/assets/preset-avatars/webp/avatar_23_dog_sunglasses.webp";
import avatar24 from "../../../packages/shared/assets/preset-avatars/webp/avatar_24_cat_astronaut.webp";
import avatar25 from "../../../packages/shared/assets/preset-avatars/webp/avatar_25_retro_robot.webp";
import avatar26 from "../../../packages/shared/assets/preset-avatars/webp/avatar_26_mushroom.webp";
import avatar27 from "../../../packages/shared/assets/preset-avatars/webp/avatar_27_vampire.webp";
import avatar28 from "../../../packages/shared/assets/preset-avatars/webp/avatar_28_pirate_parrot.webp";
import avatar29 from "../../../packages/shared/assets/preset-avatars/webp/avatar_29_friendly_alien.webp";
import avatar30 from "../../../packages/shared/assets/preset-avatars/webp/avatar_30_disco_frog.webp";

const presetAvatarAssets: Record<PresetAvatarId, StaticImageData> = {
  avatar_01: avatar01, avatar_02: avatar02, avatar_03: avatar03, avatar_04: avatar04, avatar_05: avatar05,
  avatar_06: avatar06, avatar_07: avatar07, avatar_08: avatar08, avatar_09: avatar09, avatar_10: avatar10,
  avatar_11: avatar11, avatar_12: avatar12, avatar_13: avatar13, avatar_14: avatar14, avatar_15: avatar15,
  avatar_16: avatar16, avatar_17: avatar17, avatar_18: avatar18, avatar_19: avatar19, avatar_20: avatar20,
  avatar_21: avatar21, avatar_22: avatar22, avatar_23: avatar23, avatar_24: avatar24, avatar_25: avatar25,
  avatar_26: avatar26, avatar_27: avatar27, avatar_28: avatar28, avatar_29: avatar29, avatar_30: avatar30,
};

export function getPresetAvatarSrc(id: PresetAvatarId): string {
  return presetAvatarAssets[id].src;
}
