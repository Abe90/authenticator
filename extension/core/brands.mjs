import { siteKey, validSites } from './sites.mjs';

// The bundled icons of the services where people use codes: for each, its file assets/brands/<icon>.svg, the sites
// that show it, as registrable domains, and the names that do. Adding an icon is its file and one entry here
// (tools/check.mjs compares the two). The files come from Simple Icons, filled with the service's colour, and, for
// google, microsoft, aws, linkedin, slack, zoom, adobe, yahoo, gitlab, figma, trello, openai, paypal, meta, steam,
// salesforce, ibm, sap, stackoverflow, googlecloud, firebase, atlassian, mongodb, tiktok, namecheap and claude, from
// Logos by Gil Barbara (the README's License section); ebay comes from eBay's official logo package, with a separate
// path per letter; snapchat uses the outlined Ghost from snapchat.com and huggingface the logo without border from
// huggingface.co; ea, unity and pinterest are the marks of the logos on Wikimedia Commons, without the words. A
// colour too light for the light theme gives way to a dark one in the file; dark marks the icons too dark for the
// dark theme, which shows them in the colour of its text. The logos belong to their owners and show only next to an
// account.
export const BRANDS = [
  { icon: 'google', sites: ['google.com'], names: ['Google', 'Gmail'] },
  { icon: 'microsoft', sites: ['microsoft.com', 'live.com', 'microsoftonline.com', 'outlook.com', 'office.com', 'azure.com'],
    names: ['Microsoft', 'Outlook', 'Azure', 'Office 365'] },
  { icon: 'amazon', dark: true,
    sites: ['amazon.com', 'amazon.it', 'amazon.de', 'amazon.co.uk', 'amazon.fr', 'amazon.es', 'amazon.ca',
      'amazon.com.au', 'amazon.co.jp', 'amazon.in', 'amazon.com.br', 'amazon.com.mx', 'amazon.nl', 'amazon.se',
      'amazon.pl', 'amazon.com.be', 'amazon.ie', 'amazon.ae', 'amazon.sa', 'amazon.com.tr', 'amazon.sg',
      'amazon.eg', 'amazon.co.za'], names: ['Amazon'] },
  { icon: 'aws', dark: true, sites: ['amazonaws.com', 'awsapps.com'], names: ['AWS', 'Amazon Web Services'] },
  { icon: 'facebook', sites: ['facebook.com'], names: ['Facebook'] },
  { icon: 'instagram', sites: ['instagram.com'], names: ['Instagram'] },
  { icon: 'x', dark: true, sites: ['x.com', 'twitter.com'], names: ['X', 'Twitter'] },
  { icon: 'linkedin', sites: ['linkedin.com'], names: ['LinkedIn'] },
  { icon: 'reddit', sites: ['reddit.com'], names: ['Reddit'] },
  { icon: 'discord', sites: ['discord.com', 'discordapp.com'], names: ['Discord'] },
  { icon: 'twitch', sites: ['twitch.tv'], names: ['Twitch'] },
  { icon: 'snapchat', dark: true, sites: ['snapchat.com'], names: ['Snapchat'] },
  { icon: 'tiktok', dark: true, sites: ['tiktok.com'], names: ['TikTok'] },
  { icon: 'pinterest', sites: ['pinterest.com'], names: ['Pinterest'] },
  { icon: 'tumblr', dark: true, sites: ['tumblr.com'], names: ['Tumblr'] },
  { icon: 'slack', sites: ['slack.com'], names: ['Slack'] },
  { icon: 'zoom', sites: ['zoom.us', 'zoom.com'], names: ['Zoom'] },
  { icon: 'dropbox', sites: ['dropbox.com'], names: ['Dropbox'] },
  { icon: 'box', sites: ['box.com'], names: ['Box'] },
  { icon: 'adobe', sites: ['adobe.com'], names: ['Adobe'] },
  { icon: 'yahoo', dark: true, sites: ['yahoo.com'], names: ['Yahoo'] },
  { icon: 'github', dark: true, sites: ['github.com'], names: ['GitHub'] },
  { icon: 'gitlab', sites: ['gitlab.com'], names: ['GitLab'] },
  { icon: 'bitbucket', sites: ['bitbucket.org'], names: ['Bitbucket'] },
  { icon: 'atlassian', sites: ['atlassian.com', 'atlassian.net'], names: ['Atlassian'] },
  { icon: 'npm', sites: ['npmjs.com'], names: ['npm'] },
  { icon: 'docker', sites: ['docker.com'], names: ['Docker'] },
  { icon: 'unity', dark: true, sites: ['unity.com', 'unity3d.com'], names: ['Unity'] },
  { icon: 'figma', sites: ['figma.com'], names: ['Figma'] },
  { icon: 'trello', sites: ['trello.com'], names: ['Trello'] },
  { icon: 'asana', sites: ['asana.com'], names: ['Asana'] },
  { icon: 'linear', sites: ['linear.app'], names: ['Linear'] },
  { icon: 'evernote', sites: ['evernote.com'], names: ['Evernote'] },
  { icon: 'grafana', sites: ['grafana.com'], names: ['Grafana'] },
  { icon: 'mongodb', sites: ['mongodb.com'], names: ['MongoDB'] },
  { icon: 'cloudflare', sites: ['cloudflare.com'], names: ['Cloudflare'] },
  { icon: 'akamai', sites: ['akamai.com', 'linode.com'], names: ['Akamai', 'Linode'] },
  { icon: 'huggingface', sites: ['huggingface.co'], names: ['Hugging Face', 'HuggingFace'] },
  { icon: 'openai', dark: true, sites: ['openai.com', 'chatgpt.com'], names: ['OpenAI', 'ChatGPT'] },
  { icon: 'anthropic', dark: true, sites: ['anthropic.com'], names: ['Anthropic'] },
  { icon: 'claude', sites: ['claude.ai', 'claude.com'], names: ['Claude'] },
  { icon: 'namecheap', sites: ['namecheap.com'], names: ['Namecheap'] },
  { icon: 'godaddy', sites: ['godaddy.com'], names: ['GoDaddy'] },
  { icon: 'wordpress', sites: ['wordpress.com', 'wordpress.org'], names: ['WordPress'] },
  { icon: 'shopify', sites: ['shopify.com'], names: ['Shopify'] },
  { icon: 'squarespace', dark: true, sites: ['squarespace.com'], names: ['Squarespace'] },
  { icon: 'hubspot', sites: ['hubspot.com'], names: ['HubSpot'] },
  { icon: 'proton', sites: ['proton.me', 'protonmail.com', 'protonvpn.com'],
    names: ['Proton', 'ProtonMail', 'ProtonVPN'] },
  { icon: 'bitwarden', sites: ['bitwarden.com', 'bitwarden.eu'], names: ['Bitwarden'] },
  { icon: '1password', sites: ['1password.com', '1password.eu', '1password.ca'], names: ['1Password'] },
  { icon: 'lastpass', sites: ['lastpass.com'], names: ['LastPass'] },
  { icon: 'keeper', sites: ['keepersecurity.com', 'keepersecurity.eu'], names: ['Keeper'] },
  { icon: 'nordvpn', sites: ['nordvpn.com', 'nordaccount.com'], names: ['NordVPN', 'Nord Account'] },
  { icon: 'auth0', sites: ['auth0.com'], names: ['Auth0'] },
  { icon: 'teamviewer', dark: true, sites: ['teamviewer.com'], names: ['TeamViewer'] },
  { icon: 'paypal', dark: true, sites: ['paypal.com'], names: ['PayPal'] },
  { icon: 'stripe', sites: ['stripe.com'], names: ['Stripe'] },
  { icon: 'revolut', dark: true, sites: ['revolut.com'], names: ['Revolut'] },
  { icon: 'epicgames', dark: true, sites: ['epicgames.com', 'unrealengine.com'], names: ['Epic Games'] },
  { icon: 'ubisoft', dark: true, sites: ['ubisoft.com', 'ubi.com'], names: ['Ubisoft'] },
  { icon: 'ea', sites: ['ea.com'], names: ['EA', 'Electronic Arts'] },
  { icon: 'xbox', dark: true, sites: ['xbox.com'], names: ['Xbox'] },
  { icon: 'playstation', sites: ['playstation.com', 'sonyentertainmentnetwork.com'], names: ['PlayStation', 'PSN'] },
  { icon: 'gogdotcom', sites: ['gog.com'], names: ['GOG'] },
  { icon: 'ebay', sites: ['ebay.com', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.it', 'ebay.es'], names: ['eBay'] },
  { icon: 'airbnb', sites: ['airbnb.com'], names: ['Airbnb'] },
  { icon: 'bookingdotcom', dark: true, sites: ['booking.com'], names: ['Booking.com', 'Booking'] },
  { icon: 'uber', dark: true, sites: ['uber.com'], names: ['Uber'] },
  { icon: 'patreon', dark: true, sites: ['patreon.com'], names: ['Patreon'] },
  { icon: 'kickstarter', sites: ['kickstarter.com'], names: ['Kickstarter'] },
  { icon: 'nvidia', sites: ['nvidia.com'], names: ['NVIDIA'] },
  { icon: 'mozilla', dark: true, sites: ['mozilla.org', 'firefox.com'], names: ['Mozilla', 'Firefox'] },
  { icon: 'ubuntu', sites: ['ubuntu.com'], names: ['Ubuntu'] },
  { icon: 'wikipedia', dark: true, sites: ['wikipedia.org', 'wikimedia.org'], names: ['Wikipedia', 'Wikimedia'] },
  { icon: 'plex', sites: ['plex.tv'], names: ['Plex'] },
  { icon: 'nextcloud', sites: ['nextcloud.com'], names: ['Nextcloud'] },
  { icon: 'homeassistant', sites: ['home-assistant.io'], names: ['Home Assistant'] },
  { icon: 'apple', dark: true, sites: ['apple.com', 'icloud.com'], names: ['Apple', 'iCloud'] },
  { icon: 'meta', sites: ['meta.com'], names: ['Meta'] },
  { icon: 'tesla', sites: ['tesla.com'], names: ['Tesla'] },
  { icon: 'steam', dark: true, sites: ['steampowered.com', 'steamcommunity.com'], names: ['Steam'] },
  { icon: 'rockstargames', dark: true, sites: ['rockstargames.com'], names: ['Rockstar'] },
  { icon: 'n26', sites: ['n26.com'], names: ['N26'] },
  { icon: 'salesforce', sites: ['salesforce.com', 'force.com'], names: ['Salesforce'] },
  { icon: 'ibm', dark: true, sites: ['ibm.com'], names: ['IBM'] },
  { icon: 'sap', sites: ['sap.com'], names: ['SAP'] },
  { icon: 'stackoverflow', sites: ['stackoverflow.com', 'stackexchange.com'], names: ['Stack Overflow', 'Stack Exchange'] },
  { icon: 'googlecloud', sites: [], names: ['Google Cloud', 'GCP'] },
  { icon: 'firebase', sites: [], names: ['Firebase'] },
];

const icons = new Set(BRANDS.map(({ icon }) => icon));
const darkIcons = new Set(BRANDS.filter(({ dark }) => dark).map(({ icon }) => icon));
const bySite = new Map(BRANDS.flatMap(({ icon, sites }) => sites.map((site) => [site, icon])));
// The longest first, so that Proton Mail is not taken for a shorter name it starts with.
const byName = BRANDS.flatMap(({ icon, names }) => names.map((name) => [name.toLowerCase(), icon]))
  .sort(([a], [b]) => b.length - a.length);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Whether the set has an icon of this name.
export const isBrand = (icon) => icons.has(icon);

// Whether the dark theme shows this icon in the colour of its text.
export const isDarkBrand = (icon) => darkIcons.has(icon);

// The icon whose name starts text, whatever the case, as a whole word: "GitHub", "GitHub: mario@example.com" and
// "github (work)", not "GitHubber". otpauth:// links and Google's exports put the issuer in front this way.
function byStart(text) {
  const lower = text.trim().toLowerCase();
  for (const [name, icon] of byName) {
    if (!lower.startsWith(name)) continue;
    const next = lower.codePointAt(name.length);
    if (next === undefined || !LETTER_OR_DIGIT.test(String.fromCodePoint(next))) return icon;
  }
  return null;
}

// The bundled icon of an account, or null: that of the first of its sites that has one, then that of its name.
export function brandOf(account) {
  for (const { host } of validSites(account.sites)) {
    const icon = bySite.get(siteKey(host));
    if (icon) return icon;
  }
  return byStart(account.name);
}
