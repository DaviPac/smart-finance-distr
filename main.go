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
	"github.com/go-chi/cors"
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
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{
			"http://localhost:4200",
			"https://smart-finance-distr.vercel.app",
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type"},

		AllowCredentials: true,
	}))

	r.Group(func(r chi.Router) {
		r.Use(configApp.authMiddleware)
		r.Get("/api/groups", configApp.handleGetMyGroups)
		r.Get("/api/groups/{uid}", configApp.handleGetGroup)
		r.Post("/api/join/{uid}", configApp.handleJoinGroup)
		r.Post("/api/group", configApp.handlePostGroup)
		r.Post("/api/groups/{uid}/expenses", configApp.handlePostExpense)
		r.Delete("/api/groups/{uid}/expenses/{expenseId}", configApp.handleDeleteExpense)
		r.Post("/api/groups/{uid}/payments", configApp.handlePostPayment)
		r.Delete("/api/groups/{uid}/payments/{paymentId}", configApp.handleDeletePayment)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Servidor Go rodando na porta", port)
	http.ListenAndServe(":"+port, r)
}
