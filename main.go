package main

import (
	"context"
	"log"
	"net/http"
	"os"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"firebase.google.com/go/v4/db"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"google.golang.org/api/option"
)

type AppConfig struct {
	AuthClient *auth.Client
	DBClient   *db.Client
	APIKey     string
	JWTSecret  []byte
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Arquivo .env não encontrado, lendo variáveis de ambiente")
	}

	ctx := context.Background()
	raw := os.Getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
	if raw == "" {
		log.Fatal("FIREBASE_SERVICE_ACCOUNT_KEY não encontrada no ambiente")
	}
	dbURL := os.Getenv("FIREBASE_DATABASE_URL")

	opt := option.WithCredentialsJSON([]byte(raw))
	config := &firebase.Config{DatabaseURL: dbURL}

	app, err := firebase.NewApp(ctx, config, opt)
	if err != nil {
		log.Fatalf("Erro ao inicializar Firebase App: %v", err)
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("Erro ao inicializar Auth Client: %v", err)
	}

	dbClient, err := app.Database(ctx)
	if err != nil {
		log.Fatalf("Erro ao inicializar RTDB Client: %v", err)
	}

	configApp := &AppConfig{
		AuthClient: authClient,
		DBClient:   dbClient,
		APIKey:     os.Getenv("FIREBASE_API_KEY"),
		JWTSecret:  []byte(os.Getenv("JWT_SECRET")),
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Post("/api/register", configApp.handleRegister)
	r.Post("/api/login", configApp.handleLogin)

	r.Group(func(r chi.Router) {
		r.Use(configApp.authMiddleware)
		r.Get("/api/me", configApp.handleGetMe)
		r.Post("/api/logout", configApp.handleLogout)
		r.Get("/api/users/{uid}", configApp.handleGetUser)
		r.Get("/api/users", configApp.handleGetUsers)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Servidor Go rodando na porta", port)
	http.ListenAndServe(":"+port, r)
}
