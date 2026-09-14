/**
 * Master template defaults for the `clenqo-main` template
 * (CONTENT_SYSTEM.md §11–21; design §9: the default layout registry is
 * code-owned configuration, NOT a database table).
 *
 * Provisioned content is platform-default placeholder content
 * (DATABASE.md §55) — localized for the branch's default locale only;
 * additional locales are added through CMS translation workflows later.
 */
import type { SupportedLocale } from "@/features/branches/schemas/create-branch";

export const MASTER_TEMPLATE_KEY = "clenqo-main";

export interface SectionDefault {
  section_type: string;
  section_key: string;
  sort_order: number;
  is_enabled: boolean;
  content: Record<string, unknown>;
}

export interface PageDefault {
  slug: string;
  page_type: "home" | "services" | "about" | "contact" | "booking" | "faq" | "legal";
  sort_order: number;
  title: string;
  seo_title: string;
  seo_description: string;
  sections: SectionDefault[];
}

/** Localized platform-default strings (default locale only at provisioning). */
const PAGE_TEXT: Record<
  SupportedLocale,
  { home: string; services: string; about: string; contact: string; booking: string; faq: string; legal: string; brandLine: string }
> = {
  de: {
    home: "Startseite", services: "Leistungen", about: "Über uns",
    contact: "Kontakt", booking: "Buchung", faq: "FAQ", legal: "Rechtliches",
    brandLine: "Professionelle Reinigung – sauber, zuverlässig, unkompliziert.",
  },
  en: {
    home: "Home", services: "Services", about: "About",
    contact: "Contact", booking: "Booking", faq: "FAQ", legal: "Legal",
    brandLine: "Professional cleaning — spotless, reliable, effortless.",
  },
  fr: {
    home: "Accueil", services: "Services", about: "À propos",
    contact: "Contact", booking: "Réservation", faq: "FAQ", legal: "Mentions légales",
    brandLine: "Nettoyage professionnel — impeccable, fiable, sans effort.",
  },
  es: {
    home: "Inicio", services: "Servicios", about: "Nosotros",
    contact: "Contacto", booking: "Reserva", faq: "FAQ", legal: "Legal",
    brandLine: "Limpieza profesional — impecable, fiable, sin esfuerzo.",
  },
};

function section(
  type: string,
  key: string,
  sortOrder: number,
  content: Record<string, unknown> = {},
  isEnabled = true,
): SectionDefault {
  return { section_type: type, section_key: key, sort_order: sortOrder, is_enabled: isEnabled, content };
}

/**
 * Default page set with per-page section layouts from the section registry
 * (spec: pages = home, services, about, contact, faq, legal, booking).
 */
export function getMasterTemplatePages(defaultLocale: SupportedLocale): PageDefault[] {
  const t = PAGE_TEXT[defaultLocale];
  const heroHeadline = defaultLocale === "de" ? "Sauberkeit, der Sie vertrauen können" : "Cleanliness you can trust";
  const heroSub = t.brandLine;
  const ctaLabel = defaultLocale === "de" ? "Jetzt buchen" : "Book now";

  return [
    {
      slug: "", page_type: "home", sort_order: 0,
      title: t.home,
      seo_title: `${t.home} – CLENQO`,
      seo_description: heroSub,
      sections: [
        section("hero", "hero", 0, { headline: heroHeadline, subline: heroSub, cta_label: ctaLabel, cta_href: "/book" }),
        section("trust", "trust", 1, { items: ["insured", "verified_cleaners", "satisfaction"] }),
        section("services_overview", "services", 2),
        section("process", "process", 3, { steps: ["book", "clean", "review"] }),
        section("reviews", "reviews", 4, {}, false), // disabled until reviews exist
        section("cta", "cta", 5, { headline: ctaLabel, href: "/book" }),
      ],
    },
    {
      slug: "services", page_type: "services", sort_order: 1,
      title: t.services, seo_title: `${t.services} – CLENQO`, seo_description: heroSub,
      sections: [
        section("page_header", "header", 0, { headline: t.services }),
        section("services_list", "list", 1),
        section("cta", "cta", 2, { headline: ctaLabel, href: "/book" }),
      ],
    },
    {
      slug: "about", page_type: "about", sort_order: 2,
      title: t.about, seo_title: `${t.about} – CLENQO`, seo_description: heroSub,
      sections: [
        section("page_header", "header", 0, { headline: t.about }),
        section("text", "intro", 1, { body: heroSub }),
      ],
    },
    {
      slug: "contact", page_type: "contact", sort_order: 3,
      title: t.contact, seo_title: `${t.contact} – CLENQO`, seo_description: heroSub,
      sections: [
        section("page_header", "header", 0, { headline: t.contact }),
        section("contact_details", "details", 1),
      ],
    },
    {
      slug: "faq", page_type: "faq", sort_order: 4,
      title: t.faq, seo_title: `FAQ – CLENQO`, seo_description: heroSub,
      sections: [
        section("page_header", "header", 0, { headline: t.faq }),
        section("faq_list", "list", 1, { items: [] }),
      ],
    },
    {
      slug: "legal", page_type: "legal", sort_order: 5,
      title: t.legal, seo_title: `${t.legal} – CLENQO`, seo_description: heroSub,
      sections: [section("page_header", "header", 0, { headline: t.legal })],
    },
    {
      slug: "book", page_type: "booking", sort_order: 6,
      title: t.booking, seo_title: `${t.booking} – CLENQO`, seo_description: heroSub,
      sections: [
        section("page_header", "header", 0, { headline: t.booking }),
        section("booking_entry", "entry", 1, {}, false), // enabled when booking ships
      ],
    },
  ];
}
