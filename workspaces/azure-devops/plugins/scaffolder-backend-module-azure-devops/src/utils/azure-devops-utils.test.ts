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
import { getAzureDevOpsPullRequestURL } from './azure-devops-utils';

describe('Azure DevOps Utils', () => {
  describe('getAzureDevOpsPullRequestURL', () => {
    it('should encode project and repo names correctly', () => {
      const url = getAzureDevOpsPullRequestURL(
        'https://dev.azure.com/my-org',
        'my project',
        'my repo',
        456,
      );
      expect(url).toBe(
        'https://dev.azure.com/my-org/my%20project/_git/my%20repo/pullrequest/456',
      );
    });

    it('should handle special characters in project and repo names', () => {
      const url = getAzureDevOpsPullRequestURL(
        'https://dev.azure.com/my-org',
        'project-with-dashes',
        'repo_with_underscores',
        789,
      );
      expect(url).toBe(
        'https://dev.azure.com/my-org/project-with-dashes/_git/repo_with_underscores/pullrequest/789',
      );
    });

    it('should handle different base URLs', () => {
      const url = getAzureDevOpsPullRequestURL(
        'https://mycompany.visualstudio.com',
        'my-project',
        'my-repo',
        1,
      );
      expect(url).toBe(
        'https://mycompany.visualstudio.com/my-project/_git/my-repo/pullrequest/1',
      );
    });

    it('should handle zero pull request ID', () => {
      const url = getAzureDevOpsPullRequestURL(
        'https://dev.azure.com/my-org',
        'my-project',
        'my-repo',
        0,
      );
      expect(url).toBe(
        'https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequest/0',
      );
    });

    it('should handle large pull request IDs', () => {
      const url = getAzureDevOpsPullRequestURL(
        'https://dev.azure.com/my-org',
        'my-project',
        'my-repo',
        999999,
      );
      expect(url).toBe(
        'https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequest/999999',
      );
    });
  });
});
