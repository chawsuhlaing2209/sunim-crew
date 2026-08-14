# The component contract, and what "done" means (Gate A)

Lock this before step 4. The engineer produces the contract and the doc page; the manager checks presence, never quality.

## Definition of a done component

Every check is a boolean. If a check needs an opinion, it does not belong here.

| Check                                                       | How                             |
| ----------------------------------------------------------- | ------------------------------- |
| Story renders, URL returns 200                              | Fetch the built Storybook story |
| A screenshot exists per state                               | Stat the attachment files       |
| Contract file exists and validates against the schema below | Parse and zod-check             |
| Every value resolves to a token, zero raw hex               | Scan the component source       |
| Props are discriminated unions, no open `string`            | Type check                      |
| a11y checks pass (roles, focus order, contrast)             | Automated a11y pass             |
| Commit resolves on GitHub                                   | GET the commit URL              |
| Docs page exists, `astro_docs_url` returns 200              | Fetch the page                  |
| Docs page has every required section                        | Parse the page headings         |

Doc prose quality is signed off by a human at the `completed` gate. The manager only checks the page is there and complete.

## The contract file (per component)

Machine-readable, ships with the component. Both an agent and the manager read it.

```jsonc
{
  "id": "button",
  "name": "Button",
  "props": {/* discriminated-union schema */},
  "variants": ["primary", "secondary"],
  "sizes": ["md", "lg"],
  "states": ["default", "hover", "focus", "disabled"],
  "tokens": ["accent", "surface", "text-heading", "focus-ring"],
  "a11y": { "role": "button", "focusOrder": "...", "contrast": "AA" },
  "usage": { "whenToUse": "...", "whenNot": "..." },
  "storybookId": "ui-button--primary",
  "astroDocsUrl": "https://.../components/button",
  "version": "1.0.0",
}
```

## The doc contract (required Starlight sections)

A page is structurally done when it has all of these. The manager checks presence, you check the writing.

| Section               | Holds                                           |
| --------------------- | ----------------------------------------------- |
| Overview              | What it is, one or two lines                    |
| When to use, when not | The intent rule                                 |
| Live example          | The component rendered, not a screenshot        |
| Props / API           | The discriminated-union table from the contract |
| Variants and states   | Every variant and state, matched to the stories |
| Accessibility         | Roles, focus order, contrast notes              |
| Tokens used           | Which semantic tokens it resolves to            |
| Changelog             | Version and what changed                        |
