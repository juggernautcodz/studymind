# 📱 StudyMind Mobile Version Location Memo

## 📍 Active Project Paths

The active, migrated **StudyMind Core** project (React Native / Expo mobile app & Express server) is located at:
*   **Core Root Folder:** [Study-mind](file:///C:/Dev/Study-mind)
*   **Mobile Client App (React Native/Expo):** [client](file:///C:/Dev/Study-mind/client)
*   **Backend Express Server:** [server](file:///C:/Dev/Study-mind/server)

---

## ⚡ Key Context & History

1.  **OneDrive Migration:**
    *   To resolve filesystem permission conflicts and synchronization lag caused by Microsoft OneDrive, the active working repository was migrated entirely out of OneDrive and placed in `C:\Dev\Study-mind\`.
2.  **Staging & Cleanup of Duplicates:**
    *   All redundant, duplicate zip backups (`Study-mind (1).zip` through `Study-mind (15).zip`) and extracted duplicate folders (totaling ~1.2 GB of clutter) were cleaned out of `C:\Users\shane\Downloads\`.
    *   These duplicates are currently staged in the pending cleanup folder at [study-mind-zips](file:///C:/TO_DELETE/study-mind-zips) inside `C:\TO_DELETE\`. They are scheduled to be safely wiped on/after **May 21, 2026** using:
        ```powershell
        Remove-Item "C:\TO_DELETE" -Recurse -Force
        ```
3.  **StudyMind Web Integration:**
    *   The web-based subscription/Stripe integration version (**StudyMind Web**) remains in the web automation projects directory: [studymind-web](file:///C:/WebAutomation/projects/studymind-web).
    *   Any related Stripe CSV configuration exports were saved to [stripe-exports](file:///C:/Dev/Study-mind/stripe-exports).
