import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { ModelPlaneService } from "@amiba/app-runtime/model-plane";
import type {
  AgentModelSelection,
  ModelProviderProfile,
} from "@amiba/app-runtime/platform";

class AmibaModelPlaneRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly plane: ModelPlaneService,
  ) {
    super(ctx, "amibaModelPlane");
  }

  @Remote
  snapshot() {
    return this.plane.snapshot();
  }

  @Remote
  setDefaultSelection(
    selection: AgentModelSelection,
    expectedRevision?: number,
  ) {
    return this.plane.setDefaultSelection(selection, expectedRevision);
  }

  @Remote
  upsert(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
    expectedRevision?: number;
  }) {
    return this.plane.upsert(input);
  }

  @Remote
  remove(providerId: string, expectedRevision?: number) {
    return this.plane.remove(providerId, expectedRevision);
  }

  @Remote
  discover(input: { provider: ModelProviderProfile; apiKey?: string }) {
    return this.plane.discover(input);
  }

  @Remote
  unsetCredential(providerId: string, expectedRevision?: number) {
    return this.plane.unsetCredential(providerId, expectedRevision);
  }
}

export function applyModelPlaneRemote(
  ctx: Context,
  plane: ModelPlaneService,
): void {
  new AmibaModelPlaneRemoteService(ctx, plane);
}
