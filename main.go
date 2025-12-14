package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
)

// --- Configuração ---

type AppConfig struct {
	GroupsServiceURL string
	JWTSecret        []byte
}

func main() {
	_ = godotenv.Load()

	config := &AppConfig{
		GroupsServiceURL: os.Getenv("GROUPS_SERVICE_URL"),
		JWTSecret:        []byte(os.Getenv("JWT_SECRET")),
	}

	if config.GroupsServiceURL == "" {
		log.Fatal("GROUPS_SERVICE_URL é obrigatório")
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
	}))

	// Middleware para extrair UID e validar token (basico)
	r.Use(config.authMiddleware)

	r.Get("/api/analysis/group/{groupId}", config.handleGroupAnalysis)
	r.Get("/api/analysis/general", config.handleGeneralAnalysis)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Analytics Service rodando na porta %s", port)
	http.ListenAndServe(":"+port, r)
}
