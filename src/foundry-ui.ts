/**
 * Locators for Foundry's setup, join and world-creation screens, in one
 * place because their markup changes between majors. Each notes the
 * versions it was verified on and what differs, so supporting a new major
 * means updating this file rather than hunting through the flows.
 *
 * Supported: Foundry 12, 13 and 14.
 */
import type { Locator, Page } from "@playwright/test";

/**
 * The administrator password input on /auth or the admin prompt over setup.
 * Matched by name, which is stable across 12–14 (the label is a placeholder
 * in 13 and an aria-label in 14); Enter submits its form.
 */
export function adminPasswordField(page: Page): Locator {
  return page.locator('input[name="adminPassword"]:visible').first();
}

/** A setup screen tab heading ("Game Worlds", "Game Systems"); same on 12–14. */
export function setupTab(page: Page, name: "Game Worlds" | "Game Systems"): Locator {
  return page.getByRole("heading", { name });
}

/**
 * An installed package in the setup lists (li.package with data-package-id
 * on 12–14). Only valid while the installer is closed,
 * since the installer's entries share the id.
 */
export function installedPackage(page: Page, packageId: string): Locator {
  return page.locator(`[data-package-id='${packageId}']`).first();
}

/**
 * The package installer's search box: a search input inside #install-package
 * (12 and 13; 12's placeholder is "Package Name"), or the searchbox named
 * "Filter" (14).
 */
export function installerFilter(page: Page): Locator {
  return page
    .locator('#install-package input[type="search"]:visible')
    .or(page.getByRole("searchbox", { name: "Filter" }))
    .first();
}

/**
 * A package's entry in the open installer. The installer renders after the
 * setup list, whose entry for an installed package shares the id, so take
 * the last match.
 */
export function installerPackage(page: Page, packageId: string): Locator {
  return page.locator(`[data-package-id='${packageId}']`).last();
}

/**
 * The installer window: #install-package (a form on 12, an application div
 * on 13) or an application dialog (14).
 */
export function installerWindow(page: Page): Locator {
  return page.locator("#install-package, .window-app:has([data-package-id]), dialog:has([data-package-id])");
}

/**
 * The installer's header close control: a data-action="close" button inside
 * #install-package (13), a header-button link with an xmark/times icon (12),
 * or a header-control (14).
 */
export function installerHeaderClose(page: Page): Locator {
  return page
    .locator(
      '#install-package [data-action="close"], ' +
        ".window-app .window-header a.header-button:has(i.fa-xmark), " +
        ".window-app .window-header a.header-button:has(i.fa-times), " +
        ".window-app .header-control.fa-xmark, dialog .header-control"
    )
    .first();
}

/** A world in the setup list; li.package.world on 12–14. */
export function worldEntry(page: Page, worldTitle: string): Locator {
  return page.locator("li.package.world", { hasText: worldTitle }).first();
}

/**
 * A world entry's launch control. On 12 it is a play link that only shows
 * while the entry is hovered — hover the entry before clicking.
 */
export function worldLaunchControl(entry: Locator): Locator {
  return entry.locator("[data-action='worldLaunch'], button:has-text('Launch')").first();
}

/**
 * The World Title input in the create-world form. The form uses plain divs
 * as captions (12–14), so getByLabel() cannot associate them — anchor on
 * the caption text instead.
 */
export function worldTitleField(page: Page): Locator {
  return page.getByText("World Title", { exact: true }).locator("xpath=..").getByRole("textbox");
}

/** The create-world system picker on 12: a <select> of system ids. Absent on 13+. */
export function worldSystemDropdown(page: Page): Locator {
  return page.locator('select[name="system"]:visible');
}

/** 12's create-world submit button (13+ moves on with Continue instead). */
export function createWorldSubmit(page: Page): Locator {
  return page.locator('button[type="submit"]:visible', { hasText: /create world/i });
}

/**
 * A system in the create-world system list on 13+, by package id. Its text
 * is the package title, which need not match the installer's display name
 * (Simple Worldbuilding's title is "Simple World-Building").
 */
export function worldSystemListItem(page: Page, systemId: string): Locator {
  return page.locator(`li.package.system[data-package-id='${systemId}']:visible`).first();
}

/** The join form's user picker on 12: a <select> of user names. */
export function joinUserDropdown(page: Page): Locator {
  return page.locator('select[name="userid"]');
}

/** The join form's user picker on 13+: an autocomplete textbox. */
export function joinUserTextbox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Select User" });
}

/**
 * A suggestion in the 13+ join autocomplete: the <li> inside #autocomplete,
 * NOT the wrapping <menu>, whose text also matches — clicking the wrapper
 * selects nothing and Join silently does nothing.
 */
export function joinUserSuggestion(page: Page, userName: string): Locator {
  return page.locator("#autocomplete li", { hasText: new RegExp(`^${escapeRegExp(userName)}$`) });
}

/** The join form's submit button; same on 12–14. */
export function joinButton(page: Page): Locator {
  return page.getByRole("button", { name: "Join Game Session" });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
