/**
 * The playground's doors: which gateway surfaces it can try, and which
 * models serve each (`docs/design/playground-doors.md`).
 *
 * A door appears only when some model on `GET /v1/models` lists one of
 * its surfaces, the way the decision panel appears only when a decision
 * model is served: a form for a surface nothing serves can only fail.
 * Chat is always there, because it is the page's own door and every
 * install without a model still needs somewhere to say so.
 *
 * Pure, so the rules are tested without a page.
 */

import type { Model } from "./types";

export type DoorId = "chat" | "completion" | "speech" | "transcription" | "image" | "video";

export interface Door {
  readonly id: DoorId;
  readonly label: string;
  /** The `x_eugene_plexus.surfaces` values this door serves. */
  readonly surfaces: readonly string[];
  /** One line for the picker's title. */
  readonly hint: string;
}

/** In picker order. A door is listed here once its form exists. */
export const DOORS: readonly Door[] = [
  {
    id: "chat",
    label: "Chat",
    surfaces: ["chat"],
    hint: "POST /v1/chat/completions: a conversation, with tools and attachments",
  },
  {
    id: "completion",
    label: "Completions",
    surfaces: ["completion"],
    hint: "POST /v1/completions: a prompt continued as written, or the middle filled in",
  },
  {
    id: "speech",
    label: "Speech",
    surfaces: ["speech"],
    hint: "POST /v1/audio/speech: text read aloud",
  },
  {
    id: "transcription",
    label: "Transcription",
    surfaces: ["transcription", "translation"],
    hint: "POST /v1/audio/transcriptions and /translations: a recording written down, or put into English",
  },
];

export const DEFAULT_DOOR: DoorId = "chat";

function surfacesOf(model: Model): readonly string[] | undefined {
  return model.x_eugene_plexus?.surfaces ?? undefined;
}

/**
 * The models a door can be sent to. Chat keeps its old rule: a model
 * with no `surfaces` at all is a gateway older than the field, and
 * reads as "no opinion" rather than "no chat". Every other door needs
 * the surface named.
 */
export function modelsForDoor(models: readonly Model[], id: DoorId): Model[] {
  const door = DOORS.find((d) => d.id === id);
  if (!door) return [];
  return models.filter((m) => {
    const surfaces = surfacesOf(m);
    if (surfaces === undefined) return id === "chat";
    return door.surfaces.some((s) => surfaces.includes(s));
  });
}

/** The doors to offer: chat, then every other door some model serves. */
export function availableDoors(models: readonly Model[]): Door[] {
  return DOORS.filter((d) => d.id === "chat" || modelsForDoor(models, d.id).length > 0);
}

/**
 * The door a `?door=` value opens. An unknown value, or a door no model
 * serves right now, opens chat rather than an empty form.
 */
export function doorFromParam(param: string | null, available: readonly Door[]): DoorId {
  const found = available.find((d) => d.id === param);
  return found ? found.id : DEFAULT_DOOR;
}
