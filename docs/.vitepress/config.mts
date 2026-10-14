import { defineConfig } from "vitepress";

export default defineConfig({
  title: "BambuDeck",
  description: "A local dashboard for Bambu Lab printers.",
  base: "/BambuDeck/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "BambuDeck",
    nav: [
      { text: "Get started", link: "/getting-started" },
      { text: "Deployment", link: "/deployment" },
      { text: "GitHub", link: "https://github.com/Ripwords/BambuDeck" },
    ],
    sidebar: [
      {
        text: "Use BambuDeck",
        items: [
          { text: "Overview", link: "/" },
          { text: "Docker setup", link: "/getting-started" },
          { text: "Features", link: "/FEATURES" },
          { text: "Configuration", link: "/configuration" },
          { text: "HTTPS & iPhone", link: "/HTTPS" },
        ],
      },
      {
        text: "Maintain",
        items: [
          { text: "Deployment & releases", link: "/deployment" },
          { text: "Verification", link: "/VERIFICATION" },
        ],
      },
    ],
    search: { provider: "local" },
    outline: [2, 3],
    editLink: {
      pattern: "https://github.com/Ripwords/BambuDeck/edit/main/docs/:path",
      text: "Edit this page",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Ripwords/BambuDeck" }],
  },
});
