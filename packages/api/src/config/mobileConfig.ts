import { z } from "zod";
import { parseConfig } from "@zenvend/platform/server";

/** Policy for which iOS builds the server still supports. */
export interface MobileConfig {
  /** Builds below this are refused. `0` supports everything. */
  iosMinimumBuild: number;
  /** Builds below this get a dismissible nudge. */
  iosRecommendedBuild: number;
  /** Where the update wall sends people. */
  iosUpdateUrl: string;
}

export const MOBILE_CONFIG_TOKEN = "MobileConfig";

const schema = z.object({
  iosMinimumBuild: z.coerce.number().int().min(0).default(0),
  iosRecommendedBuild: z.coerce.number().int().min(0).default(0),
  // The listing by numeric id; a slug alone is not a page. Production points
  // IOS_UPDATE_URL at TestFlight until the app is on the App Store.
  iosUpdateUrl: z.url().default("https://apps.apple.com/app/id6835181650"),
});

export function loadMobileConfig(): MobileConfig {
  return parseConfig("mobile", schema, {
    iosMinimumBuild: process.env.IOS_MINIMUM_BUILD,
    iosRecommendedBuild: process.env.IOS_RECOMMENDED_BUILD,
    iosUpdateUrl: process.env.IOS_UPDATE_URL,
  });
}
