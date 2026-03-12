## Build Commands

```bash
make check # run both format and lint
make build-app # build the app
```

Run a single test class or method:
```bash
xcodebuild test -workspace supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

## Code Guidelines

- Project uses `SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor`
- When a new logic changes in the Reducer, always add tests
