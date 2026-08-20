# Purrtrack

Purrtrack is a pet care tracking app focused on daily cat routines. It helps caregivers log meals, water intake, litter activity, care tasks, weight changes, and short journal notes in one place, while also supporting meal schedules and iOS home screen widgets for quick actions.

## What the App Does

- Create and manage pet profiles.
- Sign in and sync data through Firebase.
- Record daily meal, water, litter, care, and journal entries.
- Track body weight over time.
- Plan recurring meal schedules.
- Review historical records by day.
- Surface quick actions and schedule info through iOS widgets.

## Main Features

### Daily Logging

The log flow is split into dedicated tabs for:

- Meal logging with food category, food name, supplements, preference tags, and kcal calculation.
- Water logging with presets, manual entry, and drag-based estimation.
- Litter logging with kind, count, size, and condition.
- Care logging for recurring pet-care activities.
- Journal logging with mood, note, and optional photo upload.

### Food and Nutrition Tools

- Shared food catalog across pets.
- Supplement catalog.
- Kcal-per-food support for automatic meal calorie calculation.
- Preference markers to remember whether a pet likes or dislikes a food.

### Schedule Management

- Weekly meal schedule editor.
- Day-based meal planning.
- Schedule-backed quick reference widget.

### History and Progress

- Historical daily log review.
- Weight tracking screen.
- Day detail view for browsing records.

### iOS Widget Support

Purrtrack includes iOS widget support for faster access from the home screen:

- Quick Log widget for food, water, and litter actions.
- Daily Meal Plan widget for viewing today's schedule.
- Deep linking from widgets into the correct in-app screen.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React Navigation
- Firebase
- TypeScript
- iOS WidgetKit extension

## Project Structure

- `src/screens`: app screens such as Log, Schedule, History, Weight Tracker, and Login.
- `src/navigator`: tab and root navigation.
- `src/hooks`: shared app state and pet session logic.
- `src/lib`: meal catalog, kcal, schedule, and migration helpers.
- `src/services`: notifications and app services.
- `ios/PurrtrackWidget`: iOS widget extension files.

## Local Development

### Install dependencies

```bash
npm install
```

If you use Bun in this project, make sure the lockfile and package manager usage stay consistent with your team workflow.

### Start Expo

```bash
npx expo start
```

### Run on iOS

```bash
npx expo run:ios
```

### Run on Android

```bash
npx expo run:android
```

### Lint

```bash
npm run lint
```

## Firebase Notes

This project includes Firebase configuration and rules files:

- `firebase.json`
- `firestore.rules`
- `storage.rules`

Deploy rules with:

```bash
npm run firebase:deploy:rules
```

## iOS Widget Notes

The widget relies on:

- App Group shared storage for active pet and schedule data.
- Deep links using the `purrtrack://` scheme.
- Native iOS files inside `ios/`.

If `ios/` is ignored in git, native widget updates must be staged with `git add -f`.

## Current Scope

Purrtrack is optimized around day-to-day pet care logging and schedule visibility, with a strong focus on fast entry, recurring routines, and home screen shortcuts for iPhone users.
