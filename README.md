# Comment Scraper Import

A Joplin plugin that turns Reddit and Hacker News threads exported with Comment Scraper into notes. Each thread becomes one note: the post at the top, then every comment with its number, score, time and a link back to it, quoted inside the comment it replies to.

[Comment Scraper](https://comment-scraper.com/) is a Chrome and Edge extension that saves a whole thread as CSV, JSON or Markdown. This plugin reads the CSV and JSON files.

## Install

In Joplin, open the plugin settings (**Tools → Options → Plugins**, or **Joplin → Preferences… → Plugins** on macOS), search for **Comment Scraper Import** and install it. Restart Joplin when it asks.

The plugin needs Joplin 3.7 or later on the desktop. It doesn't run on mobile, because it reads files through the desktop file dialog.

## Usage

1. In the extension, export a thread as **CSV**, **JSON, one row per comment** or **JSON, replies nested**. Batch exports with several threads in one file work too.
2. In Joplin, choose **Tools → Import Comment Scraper export…**. The same command is in the command palette.
3. Pick one or more export files.

Each thread becomes a note in the **Comment Scraper** notebook. The plugin creates that notebook on the first import and adds to it after that. It never changes notes that are already there, so importing the same thread twice gives you two notes.

## What a note looks like

The note title is the thread title, and the note's source URL points to the thread. The body looks like this:

````markdown
- Source: Reddit · r/smallbusiness · [original thread](https://www.reddit.com/r/smallbusiness/comments/1abcxyz/which_crm/)
- Exported: 2026-10-20 15:33 UTC
- Comments in this export: 48

> **Post** · 321 points · 2026-09-20 14:13 UTC · [link](https://www.reddit.com/r/...)
> ```
> Five of us, mostly email and a shared spreadsheet. What did you switch to?
> ```

## Comments

> **[c1]** · 57 points · 2026-09-20 15:02 UTC · [link](https://www.reddit.com/r/...)
> ```
> We tried three. The one that stuck was the one people opened without being asked.
> ```
>
> > **[c2]** · 12 points · 2026-09-20 15:40 UTC · OP · [link](https://www.reddit.com/r/...)
> > ```
> > Which one was it?
> > ```
````

A few details:

- The numbers are the ones the extension uses in its Markdown export and its AI briefs. Comments are counted in the order they appear in the file, so [c12] in a brief is [c12] in the note.
- Times are in UTC. "Exported" is when the extension fetched the thread, and "Comments in this export" is how many comments the file has. If the export stopped early, for example at a rate limit, the thread itself may have more.
- Hacker News doesn't publish comment scores, so HN comments show none. A Reddit comment whose score was still hidden shows "score hidden".
- Replies more than six levels deep stay at the sixth level and say which comment they answer, so long back-and-forths stay readable.
- Deleted and removed comments keep their place and their number, marked *(deleted)* or *(removed)*.
- Author names aren't included, because the extension doesn't export them ([why](https://comment-scraper.com/docs#why-no-usernames)). A username someone typed into their comment stays in the text.
- JSON keeps comment text exactly. In CSV, the extension puts a ' in front of text that starts with =, +, - or @ so spreadsheets don't treat it as a formula, and the plugin takes it off again. A comment that really did start with something like '- loses that apostrophe, so use JSON if that matters.

The Markdown export isn't supported: it has no links to individual comments, and its times are relative ("3d ago"). It's already Markdown, though, so you can paste it into a note as it is.

The fields in each export format are described in the [Comment Scraper docs](https://comment-scraper.com/docs#formats-and-fields).

## Why comment text is in code blocks

Anyone can write anything in a comment, including HTML, an image that loads from someone else's server, or a block that another plugin would render. Inside a code block it's only text, so the plugin puts every post and comment body in one. The downside is that Reddit formatting such as bold, lists and links shows up exactly as it was typed.

## Privacy

The plugin makes no network requests. It reads only the files you pick in the file dialog, and in Joplin it only creates the Comment Scraper notebook and new notes in it.

## Building from source

```sh
npm install
npm test
npm run dist   # writes publish/com.comment-scraper.import.jpl
```

To try a build, open the plugin settings, click the gear icon, choose **Install from file** and pick the `.jpl` file.

## License

[MIT](LICENSE)
