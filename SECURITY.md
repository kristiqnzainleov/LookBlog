# Security policy

LookBlog is a live social network (https://lookblog.vercel.app), so security reports are very welcome.

## Supported versions

Only the current version is supported: the `main` branch, which is what runs on https://lookblog.vercel.app. Fixes are made there.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Fill in the form. It's GitHub's private vulnerability reporting, so only you and the maintainer can see it.

Please include:

- what the problem is and where it is (a page, an API route or a file);
- the steps to reproduce it;
- what an attacker could do with it;
- if you have one, a suggested fix.

## What happens next

- You'll get a reply as soon as possible, usually within a few days.
- The report will be confirmed (or explained if it isn't a vulnerability), fixed on `main` and deployed.
- You'll be told when it's fixed. Credit is given in the advisory if you'd like it.

## Please

- Test only with your **own** accounts and data. Don't access, change or delete other people's accounts, messages or files.
- Don't run attacks that slow the site down or take it offline (no denial-of-service or load testing).
- Don't use automated scanners that send lots of requests to the live site.
- Give a reasonable time to fix the problem before talking about it publicly.

## In scope

- The LookBlog website and its API (https://lookblog.vercel.app)
- The code in this repository

Out of scope: problems in third-party services themselves (Vercel, Supabase, YouTube, GIPHY), and reports that need physical access to someone's device.
