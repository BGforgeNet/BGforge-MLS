<script lang="ts">
    // The notice every custom editor and panel carries, defined once so the wording and links cannot drift
    // between them. Styled by .bb-beta-notice in primitives.css, which every panel links.
    const ISSUES_URL = "https://github.com/BGforgeNet/BGforge-MLS/issues";
    const SITE_URL = "https://bgforge.net/";
    const FORUM_URL = "https://forums.bgforge.net/viewforum.php?f=35";
</script>

<span class="bb-beta-notice">
    Beta. Report problems to GitHub
    <a href={ISSUES_URL} target="_blank" rel="noreferrer">issues</a>. More:
    <a href={SITE_URL} target="_blank" rel="noreferrer">site</a>,
    <a href={FORUM_URL} target="_blank" rel="noreferrer">forum</a>.
</span>
