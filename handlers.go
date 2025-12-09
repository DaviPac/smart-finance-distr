package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Group struct {
	CreatedAt   string             `json:"createdAt"`
	Description string             `json:"description"`
	Expenses    map[string]Expense `json:"expenses"`
	MemberIds   map[string]bool    `json:"memberIds"`
	Name        string             `json:"name"`
	OwnerId     string             `json:"ownerId"`
	Payments    map[string]Payment `json:"payments"`
	Id          string             `json:"id"`
}

type Expense struct {
	Category    string  `json:"category"`
	Date        float64 `json:"date"`
	Description string  `json:"description"`
	GroupId     string  `json:"groupId"`
	Id          string  `json:"id"`
	PayerId     string  `json:"payerId"`
	Value       float64 `json:"value"`
}

type Payment struct {
	Date     string  `json:"date"`
	GroupId  string  `json:"groupId"`
	Id       string  `json:"id"`
	PayerId  string  `json:"payerId"`
	TargetId string  `json:"targetId"`
	Value    float64 `json:"value"`
}

type GroupRequest struct {
	Name string `json:"name"`
}

func (app *AppConfig) handleGetMyGroups(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	ref := app.DBClient.NewRef("user_groups/" + uid)
	var userGroupsMap map[string]bool
	if err := ref.Get(r.Context(), &userGroupsMap); err != nil {
		http.Error(w, "Erro ao buscar grupos", http.StatusInternalServerError)
		return
	}
	groups := make([]Group, 0, len(userGroupsMap))
	for groupId, isActive := range userGroupsMap {
		if isActive {
			if group, err := app.getGroup(r.Context(), groupId); err == nil {
				groups = append(groups, *group)
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

func (app *AppConfig) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	group, err := app.getGroup(r.Context(), groupUID)
	if err != nil {
		http.Error(w, "Erro ao buscar grupo", http.StatusInternalServerError)
	}
	if !group.MemberIds[uid] {
		http.Error(w, "Nao autorizado", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(group)
}

func (app *AppConfig) getGroup(ctx context.Context, uid string) (*Group, error) {
	ref := app.DBClient.NewRef("groups/" + uid)
	var group Group
	if err := ref.Get(ctx, &group); err != nil {
		fmt.Printf("erro ao buscar grupo %s: %v\n", uid, err)
		return nil, err
	}
	if group.OwnerId == "" {
		fmt.Printf("grupo %s nao encontrado\n", uid)
		return nil, fmt.Errorf("grupo não encontrado")
	}
	return &group, nil
}

func (app *AppConfig) handlePostGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	var req GroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	groupsRef := app.DBClient.NewRef("groups")
	newGroupRef, err := groupsRef.Push(r.Context(), nil)
	if err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	groupUID := newGroupRef.Key
	groupRef := app.DBClient.NewRef("groups/" + groupUID)
	groupData := Group{
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Description: "",
		Expenses:    map[string]Expense{},
		MemberIds:   map[string]bool{uid: true},
		Name:        req.Name,
		OwnerId:     uid,
		Payments:    map[string]Payment{},
		Id:          groupUID,
	}
	if err = groupRef.Set(r.Context(), groupData); err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	userGroupsRef := app.DBClient.NewRef("user_groups/" + uid)
	if err = userGroupsRef.Update(r.Context(), map[string]any{
		groupUID: true,
	}); err != nil {
		http.Error(w, "Erro ao criar grupo", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groupData)
}

func (app *AppConfig) handleJoinGroup(w http.ResponseWriter, r *http.Request) {
	uid, ok := r.Context().Value(userUIDKey).(string)
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	groupUID := chi.URLParam(r, "uid")
	userGroupsRef := app.DBClient.NewRef("user_groups/" + uid)
	userGroupsRef.Update(r.Context(), map[string]any{
		groupUID: true,
	})
	groupMembersRef := app.DBClient.NewRef("groups/" + groupUID + "/memberIds")
	groupMembersRef.Update(r.Context(), map[string]any{
		uid: true,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(true)
}
