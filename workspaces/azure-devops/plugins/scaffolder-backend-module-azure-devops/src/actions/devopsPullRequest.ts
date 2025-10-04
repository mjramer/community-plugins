/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import {
  DefaultAzureDevOpsCredentialsProvider,
  ScmIntegrationRegistry,
} from '@backstage/integration';
import { InputError } from '@backstage/errors';
import {
  getBearerHandler,
  getPersonalAccessTokenHandler,
  WebApi,
} from 'azure-devops-node-api';
import {
  GitPullRequest,
  GitRepository,
  GitPush,
  GitChange,
  VersionControlChangeType,
  ItemContentType,
  PullRequestStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import {
  serializeDirectoryContents,
  TemplateAction,
} from '@backstage/plugin-scaffolder-node';
import path from 'path';
import { getAzureDevOpsPullRequestURL } from '../utils/azure-devops-utils';

export function createAzureDevopsPullRequestAction(options: {
  integrations: ScmIntegrationRegistry;
}): TemplateAction<{
  host?: string;
  organization: string;
  project: string;
  repo: string;
  sourceBranchName: string;
  targetBranchName?: string;
  title: string;
  description: string;
  draft?: boolean;
  targetPath?: string;
  sourcePath?: string;
  token?: string;
  reviewers?: string[];
  teamReviewers?: string[];
  commitMessage?: string;
  update?: boolean;
  createSourceBranch?: boolean;
}> {
  const { integrations } = options;

  return createTemplateAction({
    id: 'publish:azure:pull-request',
    supportsDryRun: true,
    schema: {
      input: {
        required: [
          'organization',
          'project',
          'repo',
          'sourceBranchName',
          'title',
          'description',
        ],
        type: 'object',
        properties: {
          host: {
            type: 'string',
            title: 'Host',
            description: 'The host of Azure DevOps. Defaults to dev.azure.com',
          },
          organization: {
            type: 'string',
            title: 'Organization',
            description: 'The name of the Azure DevOps organization.',
          },
          project: {
            type: 'string',
            title: 'Project',
            description: 'The Azure DevOps project name.',
          },
          repo: {
            type: 'string',
            title: 'Repository',
            description: 'The Azure DevOps repository name.',
          },
          sourceBranchName: {
            type: 'string',
            title: 'Source Branch Name',
            description: 'The name of the source branch.',
          },
          targetBranchName: {
            type: 'string',
            title: 'Target Branch Name',
            description: 'The name of the target branch.',
          },
          title: {
            type: 'string',
            title: 'Pull Request Title',
            description: 'The title of the pull request.',
          },
          description: {
            type: 'string',
            title: 'Pull Request Description',
            description: 'The description of the pull request.',
          },
          draft: {
            type: 'boolean',
            title: 'Draft',
            description:
              'Whether the pull request should be created as a draft.',
          },
          sourcePath: {
            type: 'string',
            title: 'Working Subdirectory',
            description:
              'Subdirectory of working directory to copy changes from.',
          },
          targetPath: {
            type: 'string',
            title: 'Repository Subdirectory',
            description: 'Subdirectory of repository to apply changes to.',
          },
          token: {
            type: 'string',
            title: 'Authentication Token',
            description: 'The personal access token for Azure DevOps.',
          },
          reviewers: {
            type: 'array',
            items: { type: 'string' },
            title: 'Reviewers',
            description: 'List of reviewers for the pull request.',
          },
          teamReviewers: {
            type: 'array',
            items: { type: 'string' },
            title: 'Team Reviewers',
            description: 'List of team reviewers for the pull request.',
          },
          commitMessage: {
            type: 'string',
            title: 'Commit Message',
            description: 'The commit message for the pull request.',
          },
          update: {
            type: 'boolean',
            title: 'Update',
            description: 'Update the pull request if it already exists.',
          },
          createSourceBranch: {
            type: 'boolean',
            title: 'Create Source Branch',
            description:
              'Whether to create the source branch if it does not exist.',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          pullRequestUrl: {
            type: 'string',
            title: 'Pull Request URL',
            description: 'The URL of the created pull request.',
          },
          pullRequestId: {
            type: 'number',
            title: 'Pull Request ID',
            description: 'The ID of the created pull request.',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        host = 'dev.azure.com',
        organization,
        project,
        repo,
        sourceBranchName,
        targetBranchName,
        title,
        description,
        draft,
        sourcePath,
        targetPath,
        token,
        reviewers,
        commitMessage,
        createSourceBranch,
      } = ctx.input;

      const url = `https://${host}/${encodeURIComponent(organization)}`;
      const credentialProvider =
        DefaultAzureDevOpsCredentialsProvider.fromIntegrations(integrations);
      const credentials = await credentialProvider.getCredentials({ url });

      if (!credentials && !token) {
        throw new InputError(
          `No credentials provided for Azure DevOps. Please check your integrations config or provide a token.`,
        );
      }

      const authHandler =
        token || credentials?.type === 'pat'
          ? getPersonalAccessTokenHandler(token ?? credentials!.token)
          : getBearerHandler(credentials!.token);

      const webApi = new WebApi(url, authHandler);
      const gitApi = await webApi.getGitApi();

      if (ctx.isDryRun) {
        performDryRun(
          ctx,
          organization,
          project,
          repo,
          sourceBranchName,
          targetBranchName,
          title,
          description,
        );
        return;
      }

      // Ensure the repository exists
      const repository: GitRepository | undefined = await gitApi.getRepository(
        repo,
        project,
      );
      if (!repository) {
        throw new Error(`Repository ${repo} not found in project ${project}.`);
      }

      // Check if the target branch was provided
      let resolvedTargetBranchName = targetBranchName;
      if (!resolvedTargetBranchName) {
        if (!repository.defaultBranch) {
          throw new Error(
            `No target branch specified, and the repository ${repo} does not have a default branch.`,
          );
        }
        resolvedTargetBranchName = repository.defaultBranch.replace(
          'refs/heads/',
          '',
        );
        ctx.logger.debug(
          `No target branch specified. Using the default branch: ${resolvedTargetBranchName}.`,
        );
      }

      const getLatestCommit = async (branch: string) => {
        const branchRef = await gitApi.getBranch(repo, branch, project);
        if (!branchRef || !branchRef.commit) {
          throw new Error(`Branch ${branch} not found in repository ${repo}.`);
        }
        return branchRef.commit.commitId;
      };

      // Optionally create the source branch
      let sourceBranchDoesNotExist = createSourceBranch;
      if (createSourceBranch) {
        ctx.logger.debug(
          `Checking if source branch ${sourceBranchName} already exists...`,
        );

        try {
          // Check if the source branch already exists using getBranch
          const branch = await gitApi.getBranch(
            repo,
            sourceBranchName,
            project,
          );

          if (branch) {
            ctx.logger.info(
              `Source branch ${sourceBranchName} already exists. Skipping branch creation.`,
            );
            sourceBranchDoesNotExist = false;
          }
        } catch (error) {
          ctx.logger.info(
            `Source branch ${sourceBranchName} does not exist. Creating...`,
          );
          const refUpdate = {
            name: `refs/heads/${sourceBranchName}`,
            oldObjectId: '0000000000000000000000000000000000000000', // Indicates a new branch
            newObjectId: await getLatestCommit(resolvedTargetBranchName),
          };
          ctx.logger.debug(
            'Creating new branch: ',
            JSON.stringify(refUpdate, null, 2),
          );
          await gitApi.updateRefs([refUpdate], repository.id!, project);
          ctx.logger.debug(
            `Source branch ${sourceBranchName} created successfully.`,
          );
        }
      }

      const fileRoot = sourcePath
        ? resolveSafeChildPath(ctx.workspacePath, sourcePath)
        : ctx.workspacePath;

      // Read files from the source directory
      const directoryContents = await serializeDirectoryContents(fileRoot, {
        gitignore: true,
      });

      const changes: GitChange[] = generateGitChanges(
        directoryContents,
        fileRoot,
        targetPath,
      );

      const push: GitPush = {
        refUpdates: [
          {
            name: `refs/heads/${sourceBranchName}`,
            oldObjectId: sourceBranchDoesNotExist
              ? await getLatestCommit(resolvedTargetBranchName)
              : await getLatestCommit(sourceBranchName),
          },
        ],
        commits: [
          {
            comment:
              commitMessage ||
              `Automated commit from Backstage scaffolder. Added files: ${directoryContents
                .map(file => path.basename(file.path))
                .join(', ')}`,
            changes,
          },
        ],
      };
      if (!changes || changes.length === 0) {
        throw new Error('No changes to push. The changes array is empty.');
      }
      ctx.logger.debug(JSON.stringify(push, null, 2));
      await gitApi.createPush(push, repository.id!, project);

      // Create the pull request
      const pullRequest: GitPullRequest = {
        sourceRefName: `refs/heads/${sourceBranchName}`,
        targetRefName: `refs/heads/${resolvedTargetBranchName}`,
        title,
        description,
        isDraft: draft,
        reviewers: (reviewers ?? []).map(reviewer => ({
          uniqueName: reviewer,
        })),
        labels: [{ name: 'devhub-generated' }], // Add label to the pull request
      };

      const existingPullRequests =
        (await gitApi.getPullRequests(
          repository.id!,
          {
            sourceRefName: `refs/heads/${sourceBranchName}`,
            targetRefName: `refs/heads/${resolvedTargetBranchName}`,
            status: PullRequestStatus.Active, // Filter for active pull requests
          },
          project,
        )) || [];
      if (existingPullRequests.length > 0) {
        const existingPullRequest = existingPullRequests[0];
        if (!existingPullRequest.pullRequestId) {
          throw new Error(
            `Pull request created without an ID: ${JSON.stringify(
              existingPullRequest,
            )}`,
          );
        }
        ctx.logger.info(
          `Pull request already exists: PR-${existingPullRequest.pullRequestId}`,
        );
        ctx.output(
          'pullRequestUrl',
          getAzureDevOpsPullRequestURL(
            url,
            project,
            repo,
            existingPullRequest.pullRequestId,
          ),
        );
        ctx.output('pullRequestId', existingPullRequest.pullRequestId);
      } else {
        const createdPullRequest = await gitApi.createPullRequest(
          pullRequest,
          repository.id!,
          project,
        );
        if (!createdPullRequest.pullRequestId) {
          throw new Error(
            `Pull request created without an ID: ${JSON.stringify(
              createdPullRequest,
            )}`,
          );
        }
        ctx.logger.info(
          `Created pull request PR-${createdPullRequest.pullRequestId}`,
        );
        ctx.logger.debug(
          'Pull request created: ',
          JSON.stringify(createdPullRequest, null, 2),
        );
        ctx.output(
          'pullRequestUrl',
          getAzureDevOpsPullRequestURL(
            url,
            project,
            repo,
            createdPullRequest.pullRequestId,
          ),
        );
        ctx.output('pullRequestId', createdPullRequest.pullRequestId);
      }
    },
  });
}

export function generateGitChanges(
  directoryContents: any[],
  fileRoot: string,
  targetPath?: string,
): GitChange[] {
  return directoryContents
    .map(file => {
      // Ensure file.path is relative to fileRoot
      const relativePath = path.isAbsolute(file.path)
        ? path.relative(fileRoot, file.path)
        : file.path;
      const fullPath = path.posix.join('/', targetPath ?? '', relativePath);
      return {
        changeType: VersionControlChangeType.Add,
        item: {
          path: fullPath,
        },
        newContent: {
          content: file.content.toString('base64'),
          contentType: ItemContentType.Base64Encoded,
        },
      };
    })
    .filter(change => change.newContent && change.newContent.content); // Exclude invalid changes
}

function performDryRun(
  ctx: any,
  organization: string,
  project: string,
  repo: string,
  sourceBranchName: string,
  targetBranchName: string | undefined,
  title: string,
  description: string,
) {
  ctx.logger.info(`Performing dry run of creating pull request`);

  const resolvedTargetBranchName = targetBranchName || 'mocked-default-branch';
  ctx.output(
    'pullRequestUrl',
    `https://mocked-url/${organization}/${project}/${repo}/pullrequest/123`,
  );
  ctx.output('pullRequestId', 123);
  ctx.logger.info('Dry run output:');
  ctx.logger.info(`Source Branch: ${sourceBranchName}`);
  ctx.logger.info(`Target Branch: ${resolvedTargetBranchName}`);
  ctx.logger.info(`Title: ${title}`);
  ctx.logger.info(`Description: ${description}`);
}
