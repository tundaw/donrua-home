
# Firebase account and permission setup

## Permission model

- `truongnha`: the sole administrator role; can manage member accounts and all
  web features, including cleaning schedules and church-attendance QR sessions.
- A trưởng nhà can manage accounts only in their own house. Trưởng nhà accounts
  cannot be edited or deleted from the member list.
- `phonha`, `thuquy`, and `sinh_vien`: view cleaning schedules.
- All signed-in members with a profile in the same `house_id` can edit meal
  schedules and shared data.
- Firestore and Storage deny access outside the signed-in member's house.

## Initial setup

1. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**.
2. Confirm the account manager has a Firestore profile at
   `users/{Firebase Authentication UID}` with `role: "truongnha"` and a
   `house_id`. Firestore Rules validate the role when creating invitations.
3. Sign in with the Firebase CLI, then deploy the rules and web app:

   ```sh
   firebase login
   firebase use don-rua-home
   firebase deploy --only firestore:rules,hosting
   ```

## Member sign-in accounts on the Spark plan

From **Thành viên**, the trưởng nhà creates an invitation containing the
member's email, name, and approved role. The member opens the login page,
chooses **Được Trưởng nhà mời? Tạo mật khẩu đăng nhập**, enters that exact email
and a password of at least eight characters. No email verification is required.
The app creates the member profile from the invitation; the member cannot choose
their own role or house.

The application does not send an invitation email. Since invitations are matched
only by email and do not require email verification, share the login page privately
and invite only addresses whose owners you trust. Existing linked accounts can
use **Quên mật khẩu?** on the login page; the reset link is sent directly by
Firebase Authentication.

For an existing linked account, a trưởng nhà can request an email change from
the member list. The member signs in using the current email, receives a
Firebase verification link at the new email, and signs in with the new email
after confirming it. The application then synchronizes the verified email to
the Firestore profile. The displayed profile email remains unchanged until the
member completes verification.

This invitation flow uses Firebase Authentication, Firestore, and Firestore
Rules and does not require Cloud Functions. Deploy the updated rules and web
app using the command in **Initial setup**.

Cloud Functions still require the Blaze plan if you choose to deploy optional
server-side account-management functions.
