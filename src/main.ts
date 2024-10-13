import fs from 'fs';
import * as github from '@actions/github';
import * as core from '@actions/core';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';


async function run() {
  try {
    const message: string = core.getInput('message');
    const filePath: string = core.getInput('file-path');
    const githubToken: string = core.getInput('github-token');
    const commentTag: string = core.getInput('comment-tag');
    const mode: string = core.getInput('mode');
    const createIfNotExists: boolean = core.getInput('create-if-not-exists') === 'true';

    if (!message && !filePath && mode !== 'delete') {
      core.setFailed('Either "filePath" or "message" should be provided as input unless running as "delete".');
      return;
    }

    let content: string = message;
    if (!message && filePath) {
      content = fs.readFileSync(filePath, 'utf8');
    }

    const context = github.context;
    const prNumber = context.payload.pull_request?.number;
    const prTitle = context.payload.pull_request?.title
    const titleRegex = new RegExp(`\\[GLOBAL-\\d*\\]`)
    if (!prTitle.match(titleRegex)) {
      content = "Add [GLOBAL-XXX] to your PR title to link up your Jira ticket\n" + content
    }

    const octokit = github.getOctokit(githubToken);

    if (!prNumber) {
      core.setFailed('No issue/pull request in input neither in current context.');
      return;
    }

    async function createComment({
      owner,
      repo,
      issueNumber,
      body,
    }: {
      owner: string;
      repo: string;
      issueNumber: number;
      body: string;
    }) {
      const { data: comment } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });

      core.setOutput('id', comment.id);
      core.setOutput('body', comment.body);
      core.setOutput('html-url', comment.html_url);

      return comment;
    }

    async function updateComment({
      owner,
      repo,
      commentId,
      body,
    }: {
      owner: string;
      repo: string;
      commentId: number;
      body: string;
    }) {
      const { data: comment } = await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body,
      });

      core.setOutput('id', comment.id);
      core.setOutput('body', comment.body);
      core.setOutput('html-url', comment.html_url);

      return comment;
    }

    const commentTagPattern = commentTag ? `<!-- elasticspoon/actions-comment-pull-request "${commentTag}" -->` : null;
    const body = commentTagPattern ? `${content}\n${commentTagPattern}` : content;

    if (commentTagPattern) {
      type ListCommentsResponseDataType = GetResponseDataTypeFromEndpointMethod<
        typeof octokit.rest.issues.listComments
      >;
      let comment: ListCommentsResponseDataType[0] | undefined;
      for await (const { data: comments } of octokit.paginate.iterator(octokit.rest.issues.listComments, {
        ...context.repo,
        issue_number: prNumber,
      })) {
        comment = comments.find((comment) => comment?.body?.includes(commentTagPattern));
        if (comment) break;
      }

      if (comment) {
        await updateComment({
          ...context.repo,
          commentId: comment.id,
          body,
        });
        return;
      }
    }

    await createComment({
      ...context.repo,
      issueNumber: prNumber,
      body,
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
