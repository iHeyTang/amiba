/**
 * Provider-neutral vision capability for Amiba.
 *
 * A model that cannot accept images is not a dead end: DSH replaces the image
 * bytes with a placeholder naming a read-only normalized path, and this plugin
 * turns that path into an answer from a model that *can* see. The assignment
 * reuses the media capability's shape — one preference row in Settings → Model
 * services → Model assignment — while the candidate set is derived from each
 * model's own declared input modalities rather than maintained by hand.
 */
export interface VisionAssignment {
  provider: string;
  model: string;
}
