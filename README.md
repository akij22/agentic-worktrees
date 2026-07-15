<p align="center">
  <img src="docs/assets/agentic-worktrees-logo.png" width="180" alt="Agentic Worktrees logo featuring the AKW monogram" />
</p>

<h1 align="center">Agentic Worktrees</h1>

<p align="center">
  A desktop workspace for managing isolated Git worktrees and AI coding-agent sessions.
</p>

<p align="center">
  Import repositories, create task-specific branches and worktrees, then collaborate with OpenCode without leaving your local development environment.
</p>

## 1. Main features and supported functionalities

- **GitHub authentication**
  - Sign in with GitHub using the OAuth 2.0 Device Authorization Grant (Device Flow).
  - Persist and refresh GitHub credentials securely in the Electron main process.
  - Detect expired sessions, missing GitHub App installations, SAML SSO requirements, and permission errors.
  - Sign out and manage the GitHub App installation or authorization from the application.

- **Repository management**
  - Import an existing local Git repository from the file system.
  - Browse repositories available through the installed GitHub App.
  - Import one or more remote GitHub repositories into the local workspace.
  - Refresh the repository list and inspect the available branches for each repository.

- **Git worktree management**
  - Create isolated worktrees from a selected base branch.
  - Create a dedicated branch and worktree name for each task.
  - Keep worktrees associated with their repository and persist their metadata locally.
  - View the worktrees belonging to a repository from the dashboard.

- **Editor integration**
  - Detect supported editors installed on the host machine.
  - Open a selected worktree directly in Visual Studio Code, Cursor, Zed, WebStorm, IntelliJ IDEA, Sublime Text, or Android Studio.

- **AI coding-agent sessions**
  - Configure and run the local headless OpenCode executable.
  - Create and resume coding sessions for a specific worktree.
  - Send natural-language coding requests and receive streamed agent activity.
  - Select the provider/model and reasoning variant for a session.
  - Review session messages, changed files, additions, deletions, and file-level diffs.
  - Handle agent permission requests and abort an active session when needed.
  - Persist session metadata, messages, output events, and diffs in the local SQLite database.

- **Desktop workspace**
  - Use a dense dashboard designed around repository and worktree workflows.
  - Resize the dashboard sidebar and switch between light and dark themes.
  - Keep Git, filesystem, database, GitHub, and coding-agent operations in the Electron main process; the renderer communicates through typed IPC contracts.

## 2. Tech Stack

- **Desktop runtime:** Electron 43
- **Application framework:** React 19 with TypeScript 5
- **Build tooling:** Vite and Electron Forge
- **Routing:** React Router
- **Styling:** Tailwind CSS 4 with a small set of reusable UI components
- **UI icons:** Lucide React
- **Backend communication:** Typed Electron IPC with Zod request and response validation
- **Git integration:** `simple-git` and native Git commands
- **GitHub integration:** Octokit
- **AI coding agent:** OpenCode SDK and a locally managed OpenCode server process
- **Persistence:** SQLite through `better-sqlite3`, Drizzle ORM, and Drizzle Kit migrations
- **Testing:** Vitest
- **Code quality:** ESLint and TypeScript strict mode

### 2.1 OAuth technology

GitHub authentication uses the **OAuth 2.0 Device Authorization Grant**, also known as GitHub Device Flow. This flow is suitable for desktop applications because it does not require a web redirect back into the application:

1. The application requests a device code from GitHub.
2. The user opens GitHub's device verification page and enters the displayed user code.
3. The main process polls GitHub until authorization is completed, cancelled, or expires.
4. GitHub returns short-lived access credentials and a refresh token.
5. Credentials are stored by the main process using Electron's safe storage facilities when available, and access tokens are refreshed before expiry.

The application uses a GitHub App for repository access. A valid `GITHUB_CLIENT_ID` and `GITHUB_APP_SLUG` are required, and the GitHub App must be installed for at least one repository before repository operations can be used.

## 3. Installation guide

### Prerequisites

- Node.js with npm
- Git installed and available on `PATH`
- A GitHub account
- A GitHub App configured for Device Flow, with its Client ID and slug
- OpenCode installed locally if AI coding sessions are required
- At least one supported code editor installed if editor integration is required

### Setup

1. Clone the repository and enter the project directory:

   ```bash
   git clone <repository-url>
   cd agentic-worktrees
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a local environment file from the template:

   ```bash
   cp .env.example .env
   ```

4. Set the following values in `.env`:

   ```dotenv
   GITHUB_CLIENT_ID=<your-github-app-client-id>
   GITHUB_APP_SLUG=<your-github-app-slug>
   WORKTREEHUB_WORKSPACE_ROOT=<optional-local-workspace-root>
   ```

   `GITHUB_CLIENT_ID` and `GITHUB_APP_SLUG` are public application configuration values. Do not place private keys, access tokens, or other secrets in the repository or in `.env.example`.

5. Start the application in development mode:

   ```bash
   npm start
   ```

### Useful development commands

```bash
npm run typecheck   # Type-check the TypeScript project
npm test            # Run the Vitest test suite
npm run lint        # Run ESLint
npm run package     # Package the Electron application
npm run make        # Create distributable installers/archives
```

If a native dependency needs to be rebuilt for Electron, run:

```bash
npm run rebuild
```

Database migrations are initialized by the application. When database schema definitions change, generate and apply migrations with the Drizzle commands defined by the project.

## 4. Usage

1. Start the application with `npm start`.
2. Sign in to GitHub from the authentication screen. Follow the displayed device-code instructions in GitHub and complete the authorization.
3. If requested, install the configured GitHub App for the repositories you want to use, then refresh the installation status.
4. Open the dashboard and add repositories either by selecting a local Git repository or by importing repositories available through GitHub.
5. Select a repository, choose a base branch, enter a new branch name and worktree name, and create the worktree.
6. Open the new worktree in one of the detected editors, or start a coding-agent session for it.
7. In a coding-agent session, choose an available model, describe the requested change, and review the streamed response and generated diff.
8. Approve or reject permission requests when OpenCode needs to perform an operation, and use the stop action to abort a running session.
9. Use **Settings** to sign out of GitHub or select/change the local OpenCode executable.

The application stores its local database and encrypted credentials in Electron's application data directory. Keep the worktree workspace path backed up if the local worktree metadata is important to your workflow.
