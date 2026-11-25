import { z } from "zod";
import type { UpdateRequirement } from "../services/MobileClientSupportService/MobileClientSupportService.ts";
import type { Assert, Equal } from "./exactly.ts";

/**
 * The only unauthenticated endpoint on the surface: a build old enough to be
 * walled is likely also holding an expired session.
 */
export const clientSupportDto = z
  .object({
    updateRequirement: z.enum(["none", "recommended", "required"]),
    updateUrl: z.string(),
  })
  .meta({ id: "ClientSupport" });

/**
 * The `426` body. Flat like every other REST error, plus where to update, so
 * the generated Swift client decodes it instead of failing on it.
 */
export const upgradeRequiredDto = z
  .object({
    code: z.literal("UPGRADE_REQUIRED"),
    message: z.string(),
    updateUrl: z.string(),
  })
  .meta({ id: "UpgradeRequired" });

export type UpgradeRequired = z.infer<typeof upgradeRequiredDto>;

type ClientSupportShape = {
  updateRequirement: UpdateRequirement;
  updateUrl: string;
};

export type ClientSupportDtoMatches = Assert<
  Equal<z.infer<typeof clientSupportDto>, ClientSupportShape>
>;
