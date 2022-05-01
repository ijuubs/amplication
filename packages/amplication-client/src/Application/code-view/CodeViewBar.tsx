import React, { useState } from "react";
import "./CodeViewBar.scss";
import CodeViewCommits from "./CodeViewCommits";
import CodeViewSyncWithGithub from "./CodeViewSyncWithGithub";
import { isEmpty } from "lodash";
import { AppWithGitRepository } from "../git/SyncWithGithubPage";
import * as models from "../../models";
import { SearchField } from "@amplication/design-system";
import CommitFilesMenu from "./CommitFilesMenu";

const CLASS_NAME = "code-view-bar";
type Props = {
  app: AppWithGitRepository;
};

const CodeViewBar = ({ app }: Props) => {
  const { workspace } = app;
  const { gitOrganizations } = workspace;

  const [commit, setCommit] = useState<models.Commit | null>(null);

  const handleAuthWithGitClick = () => {
    window.open(`/${app.id}/github`);
  };

  const handleOnSearchChange = () => {
    console.log("handleOnSearchChange"); //todo: mh filter files
  };

  const handleSetCommit = (commit: models.Commit) => {
    setCommit(commit);
  };

  return (
    <div className={CLASS_NAME}>
      <div className={`${CLASS_NAME}__heading`}>
        <h2>File Browser</h2>
      </div>
      {isEmpty(gitOrganizations) ? (
        <CodeViewSyncWithGithub
          onSyncNewGitOrganizationClick={handleAuthWithGitClick}
        />
      ) : (
        <div>connection exist</div>
      )}

      <br />
      <div>
        <CodeViewCommits
          application={app.id}
          selectedCommit={commit}
          onSelectCommit={(commit) => {
            handleSetCommit(commit);
          }}
        />
      </div>
      <div>
        <SearchField
          label={"search files"}
          placeholder={"search files"}
          onChange={handleOnSearchChange}
        />
      </div>
      <br />
      <div>
        <CommitFilesMenu applicationId={app.id} />
      </div>
    </div>
  );
};

export default CodeViewBar;
