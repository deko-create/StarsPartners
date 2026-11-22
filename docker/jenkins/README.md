# StarsPartners QA Jenkins

This local Jenkins installation runs the controller in Docker and executes the
Playwright pipeline in the official Playwright image.

## Start

```bash
npm run jenkins:start
```

Open `http://localhost:8080` and get the one-time unlock password with:

```bash
npm run jenkins:password
```

Complete the Jenkins setup wizard and create the administrator account. Then
bootstrap the versioned Pipeline job:

```bash
npm run jenkins:bootstrap
```

The first build defaults to `DRY_RUN=true` and `USE_QA_ENV=false`.

## QA secrets

Do not commit `.env`. In Jenkins, add it as a **Secret file** credential with
the ID `qa-env`. Enable `USE_QA_ENV` only for builds that need authenticated or
integration credentials.

## Commands

```bash
npm run jenkins:start
npm run jenkins:status
npm run jenkins:logs
npm run jenkins:password
npm run jenkins:bootstrap
npm run jenkins:stop
```

Jenkins data is stored in the Docker volume `starspartners_jenkins_home` and is
not deleted by the stop command.
