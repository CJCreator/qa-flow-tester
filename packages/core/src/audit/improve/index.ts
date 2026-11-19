/** The Improved version (ADR 0049): design variants per Layout Group, with the site's brand. Node only. */
export {
  IMPROVE_INDEX_NAME,
  IMPROVE_PROMPT_TOKENS,
  IMPROVE_COMPLETION_TOKENS,
  VARIANT_BRIEFS,
  checkImproveBody,
  improveEstimate,
  improvePages,
  improvePriceFor,
  improveRequestPrice,
  makeVariants,
  readImproveIndex,
  writeImproveIndex,
  variantFileName,
  variantJobs,
  type ImproveIo,
  type MakeVariantsInput,
  type MakeVariantsOptions,
} from './variants.js';
export {
  gateVariant,
  labAxeScan,
  breaksWhenSanitized,
  keepsMenuLinks,
  citationsResolve,
  GATE_REASONS,
  type VariantAxeScan,
  type VariantGateInput,
} from './quality-gate.js';
export { decodePng, findLogo, screenshotColours, siteBrand, type SiteBrand } from './brand.js';
