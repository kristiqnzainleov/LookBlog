// Temporary / disposable email addresses (mail.tm, 10minutemail, guerrillamail…) can't be used to sign up.
// Bots make accounts with them by the dozen. Three checks:
//   1. the domain is a known disposable one (or a subdomain of one)
//   2. the domain's mail goes to a disposable service's mail server (catches services like mail.tm that
//      hand out a new domain every few days)
//   3. the domain doesn't exist at all (nobody could ever get mail there)
// If the DNS lookup is slow or fails for another reason, the address is allowed (a real person is never stuck).
const dns = require("dns").promises;

const DOMAINS = new Set(`
mail.tm mail.gw euploading.com punkproof.com chitthi.in
10minutemail.com 10minutemail.net 10minutemail.co.uk 10minemail.com 10mail.org 20minutemail.com 20minutemail.it 30minutemail.com 33mail.com
guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamail.info guerrillamailblock.com sharklasers.com grr.la pokemail.net spam4.me
mailinator.com mailinator.net mailinator.org mailinator2.com mailinater.com notmailinator.com binkmail.com bobmail.info chammy.info devnullmail.com letthemeatspam.com mailinator.us reallymymail.com safetymail.info sogetthis.com spamhereplease.com streetwisemail.com suremail.info thisisnotmyrealemail.com tradermail.info veryrealemail.com zippymail.info
yopmail.com yopmail.net yopmail.fr cool.fr.nf jetable.fr.nf nospam.ze.tc nomail.xl.cx mega.zik.dj speed.1s.fr courriel.fr.nf moncourrier.fr.nf monemail.fr.nf monmail.fr.nf
temp-mail.org temp-mail.io temp-mail.ru tempmail.com tempmail.net tempmail.de tempmail.us.com tempmail.dev tempmailo.com tempmail.plus tempmail.email tempmailaddress.com tempmails.net tempr.email tempinbox.com tempomail.fr temporarymail.com temporary-mail.net tmpmail.org tmpmail.net tmpeml.com tmail.ws tmails.net
throwawaymail.com throwam.com trashmail.com trashmail.de trashmail.net trashmail.io trashmail.me trash-mail.com trashmail.at trashmail.ws trashymail.com trbvm.com
dispostable.com disposablemail.com disposable.email discard.email discardmail.com discardmail.de dropmail.me emailondeck.com email-fake.com emailfake.com fakeinbox.com fakemail.net fakemailgenerator.com fake-mail.net
getnada.com nada.email nada.ltd getairmail.com airmail.cc mohmal.com mohmal.in moakt.com moakt.cc moakt.ws tm.in-ulm.de
maildrop.cc mailnesia.com mailcatch.com mailpoof.com mailsac.com mintemail.com mytemp.email mytrashmail.com mt2015.com mvrht.com mailnull.com mailforspam.com mail-temp.com mailtemp.info
1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com yoggm.com kzccv.com qiott.com
emlpro.com emltmp.com emlhub.com spymail.one inboxkitten.com inboxbear.com burnermail.io burner.kiwi linshiyouxiang.net
spamgourmet.com spamgourmet.net spambox.us spamex.com spamfree24.org spaml.com spamobox.com spambog.com spambog.de spambog.ru
harakirimail.com incognitomail.com incognitomail.org instantemailaddress.com jetable.org jetable.com kasmail.com klzlk.com
mailexpire.com maileater.com mailmetrash.com meltmail.com mfsa.ru nowmymail.com objectmail.com onewaymail.com opayq.com owlpic.com
crazymailing.com cuvox.de dayrep.com einrot.com fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com teleworm.us armyspy.com
guerrillamail.cc emailtemporanea.net emailtemporanea.com correotemporal.org wegwerfmail.de wegwerfmail.net wegwerfmail.org wegwerf-email.de einmalmail.de
byom.de anonbox.net anonymbox.com boximail.com cock.li deadaddress.com despam.it dodgeit.com e4ward.com emailias.com emailsensei.com
fastacura.com filzmail.com freundin.ru getonemail.com haltospam.com hidemail.de hmamail.com hulapla.de ieatspam.eu kurzepost.de lroid.com
luxusmail.org mailbidon.com mailblocks.com mailhazard.com mailhz.me mailimate.com mailmoat.com mailshell.com mailzilla.com mt2009.com
nepwk.com nobulk.com noclickemail.com nogmailspam.info nomail2me.com nospamfor.us nwldx.com pookmail.com proxymail.eu putthisinyourspamdatabase.com
rcpt.at recode.me regbypass.com rmqkr.net royal.net s0ny.net safe-mail.net selfdestructingmail.com sendspamhere.com shieldemail.com shortmail.net
skeefmail.com slopsbox.com smellfear.com snakemail.com sneakemail.com sofort-mail.de spamavert.com spamcero.com spamcorptastic.com spamday.com
spamevader.com spamhole.com spamify.com spaminator.de spamkill.info spammotel.com spamslicer.com spamspot.com spamthis.co.uk spamtrail.com
tempemail.net tempemail.co.za tempe-mail.com tempmaildemo.com tempymail.com thankyou2010.com thelimestones.com trash2009.com trashdevil.com
trashemail.de trashmailer.com twinmail.de uggsrock.com upliftnow.com venompen.com wh4f.org whyspam.me willselfdestruct.com xagloo.com
xemaps.com xents.com xmaily.com yuurok.com zehnminutenmail.de zoemail.org zetmail.com emailnax.com tempmailbox.net mailtothis.com
`.split(/\s+/).filter(Boolean));

// Mail servers of disposable services (the end of the MX host name)
const MX = ["mx.smtp.is", "guerrillamail.com", "mailinator.com", "yopmail.com", "dropmail.me", "maildrop.cc", "getnada.com", "1secmail.com",
  "mailnesia.com", "mailsac.com", "trashmail.com", "temp-mail.io", "tempmail.plus", "mohmal.com", "mailcatch.com", "fakemailgenerator.com", "emailfake.com", "harakirimail.com", "spamgourmet.com"];

const cache = new Map(); // domain -> { bad, until }
const inList = (d) => { for (let x = d; x.includes("."); x = x.slice(x.indexOf(".") + 1)) if (DOMAINS.has(x)) return true; return false; };

// Returns null (fine), "disposable" or "nodomain"
async function checkEmail(email) {
  const domain = String(email || "").split("@").pop().trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return null;
  if (inList(domain)) return "disposable";
  // (on a computer without the online database, the made-up test domains like example.test are fine)
  if (!process.env.SUPABASE_URL && /\.(test|example|invalid|localhost)$/.test(domain)) return null;
  const hit = cache.get(domain);
  if (hit && hit.until > Date.now()) return hit.bad;
  let bad = null;
  try {
    const mx = await Promise.race([dns.resolveMx(domain), new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("slow"), { code: "SLOW" })), 2500))]);
    if (mx.some(({ exchange }) => { const h = String(exchange).toLowerCase().replace(/\.$/, ""); return MX.some((m) => h === m || h.endsWith("." + m)) || inList(h); })) bad = "disposable";
  } catch (err) {
    if (err.code === "ENOTFOUND") bad = "nodomain";
    else if (err.code !== "ENODATA") { return null; } // slow or a DNS hiccup: let it through, don't remember
  }
  if (cache.size > 5000) cache.clear();
  cache.set(domain, { bad, until: Date.now() + 6 * 60 * 60 * 1000 });
  return bad;
}

const MESSAGES = {
  disposable: "Temporary email addresses can’t be used. Please use your real email.",
  nodomain: "That email domain doesn’t exist. Check for typos.",
};

module.exports = { checkEmail, MESSAGES };
