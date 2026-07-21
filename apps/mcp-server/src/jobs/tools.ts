import type { RequestContext, UUID } from "@comvenio/connector-contracts";

import { AsyncJobService } from "./service.ts";

export class JobStatusTool {
  readonly tool_name = "cv_job_status_read" as const;
  constructor(private readonly jobs: AsyncJobService) {}
  execute(input: { context: RequestContext; club_id: UUID; job_id: UUID }) {
    return this.jobs.status(input);
  }
}

export class JobCancelTool {
  readonly tool_name = "cv_job_cancel_write" as const;
  constructor(private readonly jobs: AsyncJobService) {}
  execute(input: { context: RequestContext; club_id: UUID; job_id: UUID }) {
    return this.jobs.cancel(input);
  }
}
