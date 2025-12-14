package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
)

type Group struct {
	Id          string             `json:"id"`
	Name        string             `json:"name"`
	MemberIds   map[string]bool    `json:"memberIds"`
	Expenses    map[string]Expense `json:"expenses"`
	Payments    map[string]Payment `json:"payments"`
	Description string             `json:"description"`
}

type Expense struct {
	Id       string  `json:"id"`
	Value    float64 `json:"value"`
	PayerId  string  `json:"payerId"`
	Category string  `json:"category"`
}

type Payment struct {
	Id       string  `json:"id"`
	Value    float64 `json:"value"`
	PayerId  string  `json:"payerId"`
	TargetId string  `json:"targetId"`
}

// --- Estruturas de Resposta da Análise ---

type Debt struct {
	UserId string  `json:"userId"`
	Amount float64 `json:"amount"`
}

type GroupAnalysis struct {
	GroupId         string             `json:"groupId"`
	GroupName       string             `json:"groupName"`
	MyBalance       float64            `json:"myBalance"`       // Positivo = Receber, Negativo = Dever
	TotalSpent      float64            `json:"totalSpent"`      // Total gasto pelo grupo
	MyTotalSpent    float64            `json:"myTotalSpent"`    // Total gasto por mim (share)
	OwedBy          []Debt             `json:"owedBy"`          // Quem me deve
	OweTo           []Debt             `json:"oweTo"`           // A quem eu devo
	CategorySummary map[string]float64 `json:"categorySummary"` // Gastos por categoria
}

type GeneralAnalysis struct {
	TotalBalance    float64            `json:"totalBalance"`
	TotalOwedByMe   float64            `json:"totalOwedByMe"`
	TotalOwedToMe   float64            `json:"totalOwedToMe"`
	CategorySummary map[string]float64 `json:"categorySummary"`
}

// --- Handlers ---

func (app *AppConfig) handleGroupAnalysis(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value(userUIDKey).(string)
	token := r.Context().Value(rawTokenKey).(string)
	groupId := chi.URLParam(r, "groupId")

	// 1. Buscar dados no Microsserviço de Grupos
	group, err := app.fetchGroup(groupId, token)
	if err != nil {
		http.Error(w, "Erro ao buscar grupo: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Processar Análise
	analysis := calculateGroupAnalysis(group, uid)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(analysis)
}

func (app *AppConfig) handleGeneralAnalysis(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value(userUIDKey).(string)
	token := r.Context().Value(rawTokenKey).(string)

	// 1. Buscar todos os grupos do usuário
	groups, err := app.fetchMyGroups(token)
	if err != nil {
		http.Error(w, "Erro ao buscar grupos: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Processar Análise Geral
	generalStats := GeneralAnalysis{
		CategorySummary: make(map[string]float64),
	}

	for _, grp := range groups {
		stats := calculateGroupAnalysis(&grp, uid)

		generalStats.TotalBalance += stats.MyBalance

		// Agregar categorias
		for cat, val := range stats.CategorySummary {
			generalStats.CategorySummary[cat] += val
		}

		// Agregar totais de dívidas globais
		for _, d := range stats.OwedBy {
			generalStats.TotalOwedToMe += d.Amount
		}
		for _, d := range stats.OweTo {
			generalStats.TotalOwedByMe += d.Amount
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(generalStats)
}

// --- Lógica de Negócio ---

func calculateGroupAnalysis(group *Group, myUid string) GroupAnalysis {
	analysis := GroupAnalysis{
		GroupId:         group.Id,
		GroupName:       group.Name,
		CategorySummary: make(map[string]float64),
		OwedBy:          []Debt{},
		OweTo:           []Debt{},
	}

	memberCount := float64(len(group.MemberIds))
	if memberCount == 0 {
		return analysis
	}

	// Saldo líquido de cada pessoa (Net Balance)
	// Positivo = Pagou mais do que devia (tem a receber)
	// Negativo = Consumiu mais do que pagou (tem a pagar)
	balances := make(map[string]float64)

	// Inicializar balanço com 0 para todos os membros
	for mId := range group.MemberIds {
		balances[mId] = 0
	}

	// 1. Processar Despesas
	for _, exp := range group.Expenses {
		analysis.TotalSpent += exp.Value
		analysis.CategorySummary[exp.Category] += exp.Value

		splitAmount := exp.Value / memberCount

		// O pagador "ganha" crédito pelo valor total
		balances[exp.PayerId] += exp.Value

		// Todos os membros (incluindo pagador) "perdem" a parte dividida
		for mId := range group.MemberIds {
			balances[mId] -= splitAmount
		}
	}

	// 2. Processar Pagamentos (Reembolsos diretos)
	// Se A deve a B, e A paga B:
	// A (PayerId) ganha crédito (+), B (TargetId) perde crédito (-)
	for _, pay := range group.Payments {
		balances[pay.PayerId] += pay.Value
		balances[pay.TargetId] -= pay.Value
	}

	analysis.MyBalance = balances[myUid]
	// Meu gasto real = (Total gasto pelo grupo / pessoas) ou apenas a soma das minhas shares
	// Simplificação: MyTotalSpent é o quanto eu "consumi" do grupo
	analysis.MyTotalSpent = analysis.TotalSpent / memberCount

	// 3. Resolver Dívidas (Algoritmo Simplificado)
	// Separa quem deve (debitors) de quem tem a receber (creditors)
	type person struct {
		id  string
		val float64
	}
	var debtors []person
	var creditors []person

	for id, val := range balances {
		// Arredondar para evitar problemas de ponto flutuante
		val = math.Round(val*100) / 100
		if val < 0 {
			debtors = append(debtors, person{id, -val}) // Armazena positivo para facilitar cálculo
		} else if val > 0 {
			creditors = append(creditors, person{id, val})
		}
	}

	// Ordenar para determinismo (opcional, mas bom para consistência)
	sort.Slice(debtors, func(i, j int) bool { return debtors[i].val > debtors[j].val })
	sort.Slice(creditors, func(i, j int) bool { return creditors[i].val > creditors[j].val })

	// Matching Guloso (Greedy): Pega o maior devedor e paga ao maior credor
	// Nota: Isso gera uma simplificação global. Para saber exatamente "Quem EU devo",
	// olhamos para as transações geradas onde EU estou envolvido.

	i, j := 0, 0
	for i < len(debtors) && j < len(creditors) {
		debtor := debtors[i]
		creditor := creditors[j]

		amount := math.Min(debtor.val, creditor.val)

		// Se eu sou o devedor
		if debtor.id == myUid {
			analysis.OweTo = append(analysis.OweTo, Debt{UserId: creditor.id, Amount: amount})
		}
		// Se eu sou o credor
		if creditor.id == myUid {
			analysis.OwedBy = append(analysis.OwedBy, Debt{UserId: debtor.id, Amount: amount})
		}

		// Ajustar remanescentes
		debtors[i].val -= amount
		creditors[j].val -= amount

		if debtors[i].val < 0.01 {
			i++
		}
		if creditors[j].val < 0.01 {
			j++
		}
	}

	return analysis
}

// --- Integração HTTP com Serviço de Grupos ---

func (app *AppConfig) fetchGroup(groupId, token string) (*Group, error) {
	url := fmt.Sprintf("%s/api/groups/%s", app.GroupsServiceURL, groupId)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status code %d", resp.StatusCode)
	}

	var group Group
	if err := json.NewDecoder(resp.Body).Decode(&group); err != nil {
		return nil, err
	}
	return &group, nil
}

func (app *AppConfig) fetchMyGroups(token string) ([]Group, error) {
	url := fmt.Sprintf("%s/api/groups", app.GroupsServiceURL)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status code %d", resp.StatusCode)
	}

	var groups []Group
	if err := json.NewDecoder(resp.Body).Decode(&groups); err != nil {
		return nil, fmt.Errorf("erro ao decodificar resposta JSON: %v", err)
	}

	return groups, nil
}
