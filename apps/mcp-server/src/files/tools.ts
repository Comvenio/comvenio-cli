import type { RequestContext, UploadCompleteRequest, UploadCreateRequest, UUID } from "@comvenio/connector-contracts";

import { ConnectorFileService } from "./service.ts";

export class FileUploadStartTool {
  readonly tool_name = "cv_file_upload_start_write" as const;
  constructor(private readonly files: ConnectorFileService) {}
  execute(input: { context: RequestContext; request: UploadCreateRequest }) {
    return this.files.startUpload(input);
  }
}

export class FileUploadCompleteTool {
  readonly tool_name = "cv_file_upload_complete_write" as const;
  constructor(private readonly files: ConnectorFileService) {}
  execute(input: { context: RequestContext; club_id: UUID; upload_id: UUID; completion: UploadCompleteRequest }) {
    return this.files.completeUpload(input);
  }
}

export class FileGetTool {
  readonly tool_name = "cv_file_get_read" as const;
  constructor(private readonly files: ConnectorFileService) {}
  execute(input: { context: RequestContext; club_id: UUID; file_id: UUID }) {
    return this.files.getFile(input);
  }
}
