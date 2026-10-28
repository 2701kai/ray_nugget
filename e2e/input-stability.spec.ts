import { expect, test } from '@playwright/test';

test('mobile dictation composition keeps the same focused input and text through viewport updates', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto('/'); await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  const input = page.getByLabel('Name', { exact: true }); await input.focus();
  await input.evaluate((node: HTMLInputElement) => {
    (window as any).__dictationNode = node;
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, 'Synthetic dictated name');
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'Synthetic dictated name', isComposing: true }));
    node.setSelectionRange(10, 10);
  });
  await page.setViewportSize({ width: 402, height: 510 });
  await expect(input).toHaveValue('Synthetic dictated name');
  expect(await input.evaluate(node => node === (window as any).__dictationNode && node === document.activeElement && (node as HTMLInputElement).selectionStart === 10)).toBe(true);
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Synthetic dictated name' })));
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic dictated name', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Synthetic dictated name', exact: true })).toBeVisible();
});
