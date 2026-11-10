import { describe, expect, it } from "vite-plus/test";

import { readableProviderErrorMessage } from "./providerErrorMessage.ts";

describe("readableProviderErrorMessage", () => {
  it.each([
    {
      message: "<none>",
      status: 503,
      body: "<title> Service\n unavailable </title>",
      expected: "Service unavailable (HTTP 503).",
    },
    {
      message: " <NoNe> ",
      status: 502,
      body: "bad gateway",
      expected: "The model provider failed the request (HTTP 502).",
    },
    {
      message: "<none>",
      expected: "The model provider failed the request and did not include an error message.",
    },
    {
      message: "provider says no",
      status: 503,
      body: "<title>Unavailable</title>",
      expected: "provider says no",
    },
  ])("reads $expected", ({ message, status, body, expected }) => {
    expect(readableProviderErrorMessage(message, status, body)).toBe(expected);
  });
});
