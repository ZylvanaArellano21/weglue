import { redirect } from "next/navigation";

// The interstitial that used to live here mixed the onboarding survey and
// the app-download choice into one screen. Get Started now goes straight to
// the survey and Download App goes straight to /download — this route stays
// only so old bookmarks/QR codes/shared links still land somewhere useful.
export default function GetStartedPage(): never {
  redirect("/onboarding/interests");
}
