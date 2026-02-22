![banner dvinyl](./docs/img/banner.png)

--- 

**DVinyl** is a modern, self-hostable music collection manager. It allows you to catalog, value, and manage your Vinyls, CDs, and Cassettes in one interface.

Built in JavaScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Yes-green.svg)](#)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](#)



## Overview

DVinyl allows you to keep track of your physical music, books or even DVD collection. It uses the Discogs API, Google Books API & TMDB API to retrieve important metadata and, for music, market valuations for your collection. This provides you with a convenient and full customizable dashboard for your home server.

## ✨ Key Features

### 📚 Universal Collection Management

   * **Multi-Format Support:** Manage your Music (Vinyls, CDs, Cassettes), Books (Manga, Comics, Hardcover), and Movies (Blu-ray, 4K, VHS, LaserDisc) in one unified library.
   * **Smart Import:** Add items instantly using Discogs Release IDs or import your entire existing Discogs collection in one click.
   * **Physical Scanner:*** Scan your physical media to bridge the gap between your shelf and your digital database.
   * **Advanced Organization:** Easily track the physical location of every item in your home.

### 🎨 Fully Customizable Experience

   * **Tailored Interface:** Customize your navigation bar with shortcuts that matter to you.
   * **Personalized Analytics:** Build your dashboard with modular statistics widgets.
   * **Category Themes:** Apply unique visual themes to differentiate your music, book, and movie libraries.
   * **Native Design:** Optimized for mobile with seamless Dark & Light modes.

### 💎 Advanced Tools & Privacy

   * **Market Insights:** Get real-time value estimates (Low/Median/High) for your **music** collection.
   * **Wishlist System:** Keep track of your future finds.
   * **Secure Access:** Integrated authentication system for private viewing or sharing your collection with others.
   * **Multilingual:** Fully localized in English 🇬🇧 and French 🇫🇷.


*<small>(may only work in France)</small>

## Documentation

To keep things organized, I have split the documentation into specialized guides:

* 🏁 [**Getting Started**](./docs/getting-started.md) - Manual installation and requirements.
* 🐳 [**Docker Deployment**](./docs/docker.md) - Deploying via Docker Compose *(Recommended)*.
* 🔑 [**API Configuration**](./docs/api-keys.md) - How to obtain your Discogs and Google API keys.

---

## Quick Start (Docker)

The fastest way to run DVinyl is using the pre-built Docker image. You only need a `docker-compose.yml` and a `.env` file.

1. **Create a `docker-compose.yml`** (see [Docker Deployment Guide](./docs/docker.md) for the full file).
2. **Setup your environment variables** in a `.env` file (go check how to get your [api keys](./docs/api-keys.md)).
3. **Run the application**:
   ```bash
   docker compose up -d
   ```

Access the application at `http://localhost:3099`.

# Tech stack

| **Component**    | **Technology**                 |
| :--------------- | :----------------------------- |
| **Backend**      | Node.js / Express              |
| **Database**     | MongoDB                        |
| **Frontend**     | EJS Templates                  |
| **Styling**      | Tailwind CSS                   |
| **Localization** | i18next                        |
| **API**          | Discogs / Google Custom Search |

# Screenshots

| 🖥️ Desktop View | 📱 Mobile View |
|-----------------|----------------|
| ![Dashboard Desktop](./docs/img/desktop-dashboard.jpg) | ![Dashboard Mobile](./docs/img/mobile-dashboard.png) |
| [![Collection Desktop](./docs/img/desktop-collection.jpg)](./docs/img/desktop-collection.jpg) | [![Collection Mobile](./docs/img/mobile-collection.png)](./docs/img/mobile-collection.png) |
| [![Detail Desktop](./docs/img/desktop-detail.jpg)](./docs/img/desktop-detail.jpg) | [![Detail Mobile](./docs/img/mobile-detail.png)](./docs/img/mobile-detail.png) |


# 🤝 Contributing

Honestly, this is my first app of this kind. I am open to any help and advice for this app and my future ones!

If you want to help, you can:

1. Fork the project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

# 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

<br>

> [!IMPORTANT]
>
> Please note that parts of the frontend and docstrings were generated with the assistance of AI tools. While I reviewed and corrected the output where necessary, this project is not 100% human-made.
>
> Your feedback is highly appreciated, even for the backend, where I may have made significant errors. I would be grateful for any suggestions or comments to improve the project.
>
> Thank you for your understanding <3
