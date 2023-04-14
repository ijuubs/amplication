import { parse } from "path";
import { GitProvider } from "../../git-provider.interface";
import {
  OAuthTokens,
  Branch,
  GitProviderCreatePullRequestArgs,
  CreatePullRequestFromFilesArgs,
  CreateRepositoryArgs,
  CurrentUser,
  GetFileArgs,
  GitProviderGetPullRequestArgs,
  GetRepositoriesArgs,
  GetRepositoryArgs,
  GitFile,
  RemoteGitOrganization,
  RemoteGitRepos,
  RemoteGitRepository,
  CloneUrlArgs,
  Commit,
  CreateBranchArgs,
  CreatePullRequestCommentArgs,
  EnumGitProvider,
  GetBranchArgs,
  PullRequest,
  PaginatedGitGroup,
  BitBucketConfiguration,
  Bot,
  OAuthProviderOrganizationProperties,
} from "../../types";
import { CustomError, NotImplementedError } from "../../utils/custom-error";
import {
  authDataRequest,
  authorizeRequest,
  createBranchRequest,
  createCommentOnPrRequest,
  currentUserRequest,
  currentUserWorkspacesRequest,
  getBranchRequest,
  getFileMetaRequest,
  getFileRequest,
  getFirstCommitRequest,
  refreshTokenRequest,
  repositoriesInWorkspaceRequest,
  repositoryCreateRequest,
  repositoryRequest,
  getPullRequestByBranchNameRequest,
  createPullRequestFromRequest,
} from "./requests";
import { ILogger } from "@amplication/util/logging";
import { PaginatedTreeEntry, TreeEntry } from "./bitbucket.types";
import { BitbucketNotFoundError } from "./errors";

export class BitBucketService implements GitProvider {
  private clientId: string;
  private clientSecret: string;
  private auth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  public readonly name = EnumGitProvider.Bitbucket;
  public readonly domain = "bitbucket.com";
  private logger: ILogger;

  constructor(
    providerOrganizationProperties: OAuthProviderOrganizationProperties,
    providerConfiguration: BitBucketConfiguration,
    logger: ILogger
  ) {
    this.logger = logger.child({
      metadata: {
        className: BitBucketService.name,
      },
    });
    const { accessToken, refreshToken, expiresAt } =
      providerOrganizationProperties;

    this.auth = { accessToken, refreshToken, expiresAt };
    const { clientId, clientSecret } = providerConfiguration;

    if (!clientId || !clientSecret) {
      this.logger.error("Missing Bitbucket configuration");
      throw new Error("Missing Bitbucket configuration");
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async init(): Promise<void> {
    this.logger.info("BitbucketService init");
  }

  getGitInstallationUrl(amplicationWorkspaceId: string): Promise<string> {
    return authorizeRequest(this.clientId, amplicationWorkspaceId);
  }

  async getOAuthTokens(authorizationCode: string): Promise<OAuthTokens> {
    const authData = await authDataRequest(
      this.clientId,
      this.clientSecret,
      authorizationCode
    );

    this.logger.info("BitBucketService: getAccessToken");

    return {
      accessToken: authData.access_token,
      refreshToken: authData.refresh_token,
      scopes: authData.scopes.split(" "),
      tokenType: authData.token_type,
      expiresAt: Date.now() + authData.expires_in * 1000, // 7200 seconds = 2 hours
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const newOAuthTokens = await refreshTokenRequest(
      this.clientId,
      this.clientSecret,
      refreshToken
    );

    this.logger.info("BitBucketService: refreshAccessToken");
    this.auth.accessToken = newOAuthTokens.access_token;

    return {
      accessToken: newOAuthTokens.access_token,
      refreshToken: newOAuthTokens.refresh_token,
      scopes: newOAuthTokens.scopes.split(" "),
      tokenType: newOAuthTokens.token_type,
      expiresAt: Date.now() + newOAuthTokens.expires_in * 1000, // 7200 seconds = 2 hours
    };
  }

  async getCurrentOAuthUser(accessToken: string): Promise<CurrentUser> {
    const currentUser = await currentUserRequest(accessToken);

    const { links, display_name, username, uuid } = currentUser;
    this.logger.info("BitBucketService getCurrentUser");
    return {
      links: {
        avatar: links.avatar,
      },
      displayName: display_name,
      username,
      uuid,
      useGroupingForRepositories: true,
    };
  }

  async getGitGroups(): Promise<PaginatedGitGroup> {
    const paginatedWorkspaceMembership = await currentUserWorkspacesRequest(
      this.auth.accessToken
    );

    const {
      size: total,
      page,
      pagelen: pageSize,
      next,
      previous,
      values,
    } = paginatedWorkspaceMembership;
    const gitGroups = values.map(({ workspace }) => {
      const { uuid: workspaceUuid, name, slug } = workspace;
      return {
        id: workspaceUuid,
        name,
        slug,
      };
    });

    this.logger.info("BitBucketService getGitGroups");

    return {
      total,
      page,
      pageSize,
      next,
      previous,
      groups: gitGroups,
    };
  }

  async getOrganization(): Promise<RemoteGitOrganization> {
    throw NotImplementedError;
  }

  async getRepository(
    getRepositoryArgs: GetRepositoryArgs
  ): Promise<RemoteGitRepository> {
    const { repositoryGroupName, repositoryName } = getRepositoryArgs;

    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    const repository = await repositoryRequest(
      repositoryGroupName,
      repositoryName,
      this.auth.accessToken
    );
    const { links, name, is_private, full_name, mainbranch, accessLevel } =
      repository;

    return {
      name,
      url: links.html.href,
      private: is_private,
      fullName: full_name,
      admin: !!(accessLevel === "admin"),
      defaultBranch: mainbranch.name,
    };
  }

  async getRepositories(
    getRepositoriesArgs: GetRepositoriesArgs
  ): Promise<RemoteGitRepos> {
    const { repositoryGroupName, limit, page } = getRepositoriesArgs;

    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    const repositoriesInWorkspace = await repositoriesInWorkspaceRequest(
      repositoryGroupName,
      limit,
      page,
      this.auth.accessToken
    );

    const { size, values } = repositoriesInWorkspace;
    const gitRepos = values.map(
      ({ name, is_private, links, full_name, mainbranch, accessLevel }) => {
        return {
          name,
          url: links.html.href,
          private: is_private,
          fullName: full_name,
          admin: !!(accessLevel === "admin"),
          defaultBranch: mainbranch.name,
        };
      }
    );

    return {
      repos: gitRepos,
      total: size,
      currentPage: page,
      pageSize: limit,
    };
  }

  async createRepository(
    createRepositoryArgs: CreateRepositoryArgs
  ): Promise<RemoteGitRepository> {
    const {
      repositoryGroupName,
      repositoryName,
      isPrivateRepository,
      gitOrganization,
    } = createRepositoryArgs;

    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    const newRepository = await repositoryCreateRequest(
      repositoryGroupName,
      repositoryName,
      {
        is_private: isPrivateRepository,
        name: repositoryName,
        full_name: `${gitOrganization.name}/${repositoryName}`,
      },
      this.auth.accessToken
    );

    return {
      name: newRepository.name,
      url: "https://bitbucket.org/" + newRepository.full_name,
      private: newRepository.is_private,
      fullName: newRepository.full_name,
      admin: !!(newRepository.accessLevel === "admin"),
      defaultBranch: newRepository.mainbranch.name,
    };
  }

  deleteGitOrganization(): Promise<boolean> {
    // Nothing bitbucket integration works on authentication on behalf of user.
    // There is nothing to uninstall/delete when an organisation is deleted.
    return new Promise(() => true);
  }

  async getFile(file: GetFileArgs): Promise<GitFile | null> {
    let gitReference: string;
    const { owner, repositoryName, repositoryGroupName, ref, path } = file;

    if (!repositoryGroupName) {
      throw new CustomError(
        "Missing repositoryGroupName. repositoryGroupName is mandatory for BitBucket provider"
      );
    }

    if (!ref) {
      // Default to
      const repo = await this.getRepository({
        owner,
        repositoryName,
        repositoryGroupName,
      });
      gitReference = repo.defaultBranch;
    } else {
      gitReference = ref;
    }

    const fileResponse = await getFileMetaRequest(
      repositoryGroupName,
      repositoryName,
      gitReference,
      path,
      this.auth.accessToken
    );

    const fileBufferResponse = await getFileRequest(
      repositoryGroupName,
      repositoryName,
      gitReference,
      path,
      this.auth.accessToken
    );

    if ((fileResponse as PaginatedTreeEntry).values) {
      this.logger.error(
        "BitbucketService getFile: Path points to a directory, please provide a file path"
      );
      throw new CustomError(
        "Path points to a directory, please provide a file path"
      );
    }

    const gitFileResponse = fileResponse as TreeEntry;
    this.logger.info("BitBucketService getFile");

    return {
      content: fileBufferResponse.toString("utf-8"),
      htmlUrl: gitFileResponse.commit.links.html.href,
      name: parse(gitFileResponse.path).name,
      path: gitFileResponse.path,
    };
  }

  createPullRequestFromFiles(
    createPullRequestFromFilesArgs: CreatePullRequestFromFilesArgs
  ): Promise<string> {
    throw NotImplementedError;
  }

  async getPullRequest(
    getPullRequestArgs: GitProviderGetPullRequestArgs
  ): Promise<PullRequest | null> {
    const { repositoryGroupName, repositoryName, branchName } =
      getPullRequestArgs;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }
    const pullRequest = await getPullRequestByBranchNameRequest(
      repositoryGroupName,
      repositoryName,
      branchName,
      this.auth.accessToken
    );
    if (pullRequest.values[0]) {
      const { links, id: pullRequestId } = pullRequest.values[0];

      return {
        url: links.html.href,
        number: pullRequestId,
      };
    }
    return null;
  }

  async createPullRequest(
    createPullRequestArgs: GitProviderCreatePullRequestArgs
  ): Promise<PullRequest> {
    const {
      repositoryGroupName,
      repositoryName,
      branchName,
      defaultBranchName,
      pullRequestTitle,
      pullRequestBody,
    } = createPullRequestArgs;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    const pullRequestData = {
      title: pullRequestTitle,
      description: pullRequestBody,
      source: {
        branch: {
          name: branchName,
        },
      },
      destination: {
        branch: {
          name: defaultBranchName,
        },
      },
    };

    const newPullRequest = await createPullRequestFromRequest(
      repositoryGroupName,
      repositoryName,
      pullRequestData,
      this.auth.accessToken
    );

    return {
      url: newPullRequest.links.html.href,
      number: newPullRequest.id,
    };
  }

  async getBranch(args: GetBranchArgs): Promise<Branch | null> {
    const { repositoryGroupName, repositoryName, branchName } = args;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    try {
      const branch = await getBranchRequest(
        repositoryGroupName,
        repositoryName,
        branchName,
        this.auth.accessToken
      );
      return {
        name: branch.name,
        sha: branch.target.hash,
      };
    } catch (error) {
      if (error instanceof BitbucketNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async createBranch(args: CreateBranchArgs): Promise<Branch> {
    const { repositoryGroupName, repositoryName, branchName, pointingSha } =
      args;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }

    const branch = await createBranchRequest(
      repositoryGroupName,
      repositoryName,
      { name: branchName, target: { hash: pointingSha } },
      this.auth.accessToken
    );

    return {
      name: branch.name,
      sha: branch.target.hash,
    };
  }

  async getFirstCommitOnBranch(args: GetBranchArgs): Promise<Commit> {
    const { repositoryGroupName, repositoryName, branchName } = args;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }
    const firstCommit = await getFirstCommitRequest(
      repositoryGroupName,
      repositoryName,
      branchName,
      this.auth.accessToken
    );

    return {
      sha: firstCommit.hash,
    };
  }

  getCloneUrl(args: CloneUrlArgs): string {
    const { repositoryGroupName, repositoryName } = args;
    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }
    return `https://x-token-auth:${this.auth.accessToken}@bitbucket.org/${repositoryGroupName}/${repositoryName}.git`;
  }

  async createPullRequestComment(
    args: CreatePullRequestCommentArgs
  ): Promise<void> {
    const {
      data: { body },
      where: {
        repositoryGroupName,
        repositoryName,
        issueNumber: pullRequestId,
      },
    } = args;

    if (!repositoryGroupName) {
      this.logger.error("Missing repositoryGroupName");
      throw new CustomError("Missing repositoryGroupName");
    }
    await createCommentOnPrRequest(
      repositoryGroupName,
      repositoryName,
      pullRequestId,
      body,
      this.auth.accessToken
    );
  }

  async getAmplicationBotIdentity(): Promise<Bot | null> {
    return null;
  }
}
