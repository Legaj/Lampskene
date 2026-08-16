# Firebase setup for Lampskene

## Console setup

1. Create or open the Firebase project used in `firebase-config.js`.
2. Enable Authentication -> Sign-in method -> Google.
3. Create a Realtime Database.
4. Deploy or paste `database.rules.json` into Realtime Database -> Rules.
5. Sign in to the app once with your own Google account.
6. In Realtime Database, copy your UID from `/profiles`.
7. Add yourself as an administrator:

```json
admins: {
  "YOUR_UID_HERE": true
}
```

After your account is an admin, the app can create the default tracker:

```json
trackers: {
  "stenskara": {
    "name": "stenskära",
    "status": "waiting-for-phone"
  }
}
```

The app seeds this automatically when an admin logs in. If you want to create it manually, use the same `stenskara` id.

## Tracker phone

Open `tracker-phone.html` on the old phone, sign in with an admin Google account, keep the tracker id as:

```text
stenskara
```

Then press `Start broadcasting GPS`.

The phone writes live location data here:

```text
trackerLocations/stenskara
```

Payload shape:

```json
{
  "lat": 59.3293,
  "lng": 18.0686,
  "accuracyMeters": 12,
  "speedMps": 0,
  "bearingDegrees": 0,
  "updatedAt": 1786740000000,
  "expiresAt": 1786740045000,
  "sourceUid": "firebase-auth-uid",
  "sourceEmail": "admin@example.com"
}
```

Only admins can write tracker locations. Normal users can read a tracker only after an admin grants them access in the app by email. A friend must sign in once before their email can be granted.

## App paths

- `/admins/{uid}`: users who can create trackers, grant tracker access, and update tracker locations.
- `/trackers/{trackerId}`: tracker metadata.
- `/trackerLocations/{trackerId}`: live tracker GPS.
- `/trackerAccess/{uid}/{trackerId}`: per-user access.
- `/roundDrafts/{roundId}/{uid}`: temporary per-user round backup so reloads restore progress.

## Notes

Do not put a service account key in the app or on the phone. The tracker phone uses normal Google sign-in and the database rules decide whether it can write.
