import { expect, test, type Page } from '@playwright/test';
import type { CatalogEntry, PlatformUser } from '@kyc/shared';

// Every registered app, opened by someone who has a role in it, must lay out cleanly
// at desktop, laptop, tablet and narrow widths. New apps are covered automatically.
const WIDTHS = [1600, 1280, 900, 700];

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) problems.push(`page scrolls sideways (${doc.scrollWidth}px > ${window.innerWidth}px)`);
    for (const badge of document.querySelectorAll<HTMLElement>('main .fui-Badge')) {
      if (badge.offsetParent === null) continue;
      const b = badge.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(badge);
      const t = range.getBoundingClientRect();
      if (t.right > b.right + 1 || t.bottom > b.bottom + 1) problems.push(`badge text overflows its pill: "${badge.innerText}"`);
      const cell = badge.closest('td, [role="gridcell"], [role="cell"]');
      if (cell && b.right > cell.getBoundingClientRect().right + 1) problems.push(`badge spills out of its cell: "${badge.innerText}"`);
    }
    for (const th of document.querySelectorAll<HTMLElement>('main th, main [role="columnheader"]')) {
      if (th.getBoundingClientRect().width < 1) problems.push(`column collapsed: "${th.innerText}"`);
    }
    return problems;
  });
}

test('every app and the landing page lay out at all widths', async ({ page, request }) => {
  const users = (await (await request.get('/api/users')).json()) as PlatformUser[];
  const catalog = (await (await request.get('/api/apps', { headers: { 'x-user-id': users[0].id } })).json()) as CatalogEntry[];
  const failures: string[] = [];

  for (const app of catalog) {
    const user = users.find((u) => u.roles[app.id]);
    expect(user, `nobody in the seed data can open ${app.id}`).toBeTruthy();
    await page.addInitScript((id) => localStorage.setItem('kyc.userId', id), user!.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByTestId(`tile-${app.id}`).click();
    await page.locator('main').waitFor();
    await page.waitForLoadState('networkidle');

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      for (const p of await layoutProblems(page)) failures.push(`${app.id} @${width}px as ${user!.id}: ${p}`);
    }
  }

  await page.goto('/');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    for (const p of await layoutProblems(page)) failures.push(`home @${width}px: ${p}`);
  }

  expect(failures).toEqual([]);
});
